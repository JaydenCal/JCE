// Finishes catalogue: materials, colours, lookup and validation.
// Display names are generic. Common Australian product colour names live in `aliases`
// and are used only for matching what a person (or the AI) types.

export const PALETTE_ORDER = ['steel', 'paint', 'brick', 'stone', 'tile', 'floor', 'frame'];

const c = (palette, slug, name, hex, aliases = []) => ({ id: `${palette}-${slug}`, palette, name, hex, aliases });

// ---------------------------------------------------------------------------------------------
// Materials. `texture` equals the id: the 3D module draws procedural textures by these ids.
// ---------------------------------------------------------------------------------------------
const m = (id, name, targets, palette) => ({ id, name, targets, palette, texture: id });

export const MATERIALS = [
  m('brick', 'Brick', ['wall'], 'brick'),
  m('render', 'Render', ['wall'], 'paint'),
  m('weatherboard', 'Weatherboard', ['wall'], 'paint'),
  m('vertical_cladding', 'Vertical cladding', ['wall'], 'paint'),
  m('grooved_cladding', 'Grooved cladding', ['wall'], 'paint'),
  m('stone', 'Stone', ['wall'], 'stone'),
  m('concrete', 'Concrete', ['wall'], 'paint'),
  m('corrugated', 'Corrugated steel', ['wall', 'roof'], 'steel'),
  m('trimdek', 'Trimdek steel', ['wall', 'roof'], 'steel'),
  m('standing_seam', 'Standing seam steel', ['wall', 'roof'], 'steel'),
  m('paint', 'Paint', ['wall'], 'paint'), // internal walls only
  m('concrete_tile', 'Concrete tile', ['roof'], 'tile'),
  m('terracotta_tile', 'Terracotta tile', ['roof'], 'tile'),
  m('timber', 'Timber', ['floor'], 'floor'),
  m('tile', 'Tile', ['floor'], 'floor'),
  m('carpet', 'Carpet', ['floor'], 'floor'),
  m('polished_concrete', 'Polished concrete', ['floor'], 'floor'),
  m('vinyl', 'Vinyl', ['floor'], 'floor'),
  m('decking', 'Decking', ['floor'], 'floor'),
];

// ---------------------------------------------------------------------------------------------
// Colours by palette.
// ---------------------------------------------------------------------------------------------
export const COLOURS = {
  // Metal walls and roofs, fascia, tanks, garage doors.
  steel: [
    c('steel', 'off-white', 'Off White', '#e4e2d5', ['surfmist', 'surf mist', 'cream white', 'pale cream']),
    c('steel', 'cream', 'Cream', '#e6d7b2', ['classic cream', 'yellow cream']),
    c('steel', 'sand', 'Warm Sand', '#cdc2a4', ['paperbark', 'beige', 'sandy']),
    c('steel', 'khaki', 'Pale Khaki', '#c7c1a9', ['evening haze', 'light khaki']),
    c('steel', 'light-grey', 'Light Grey', '#bfc0b8', ['shale grey', 'pale grey', 'light gray']),
    c('steel', 'dune', 'Taupe', '#968e80', ['dune', 'warm taupe', 'sandstone grey']),
    c('steel', 'blue-grey', 'Pale Blue Grey', '#b1b7b9', ['southerly', 'zinc', 'silver', 'zincalume']),
    c('steel', 'mid-grey', 'Mid Grey', '#838688', ['windspray', 'medium grey', 'cool grey']),
    c('steel', 'warm-grey', 'Warm Grey', '#867b6d', ['gully', 'stone grey']),
    c('steel', 'slate', 'Slate', '#6d6e70', ['wallaby', 'basalt', 'slate grey']),
    c('steel', 'driftwood', 'Driftwood', '#7a6e60', ['jasper', 'brown grey']),
    c('steel', 'dark-slate', 'Dark Slate', '#4d4d4a', ['woodland grey', 'dark slate grey', 'graphite']),
    c('steel', 'ironbark', 'Ironbark', '#4c4742', ['ironstone', 'dark brown grey', 'dark bronze']),
    c('steel', 'charcoal', 'Charcoal', '#323233', ['monument', 'dark grey', 'dark gray', 'anthracite', 'charcoal grey']),
    c('steel', 'black', 'Black', '#1d1e20', ['night sky', 'jet black', 'matt black', 'pitch black']),
    c('steel', 'deep-blue', 'Deep Blue', '#3f4c58', ['deep ocean', 'navy', 'dark blue']),
    c('steel', 'forest', 'Forest Green', '#31453a', ['cottage green', 'dark green', 'heritage green']),
    c('steel', 'gum-green', 'Gum Green', '#59685c', ['rivergum', 'river gum', 'mid green', 'green']),
    c('steel', 'sage', 'Sage', '#909e88', ['pale eucalypt', 'eucalypt', 'light green']),
    c('steel', 'barn-red', 'Barn Red', '#6f3532', ['manor red', 'dark red', 'red', 'maroon']),
    c('steel', 'bronze', 'Bronze', '#6e5b49', ['terrain', 'brown', 'mid brown']),
    c('steel', 'rust', 'Rust Red', '#8a4f3a', ['headland', 'rust', 'terracotta red', 'burnt orange']),
  ],
  brick: [
    c('brick', 'light-grey', 'Light Grey', '#b9b6af', ['silver', 'pale grey', 'light gray', 'ash grey', 'silver grey']),
    c('brick', 'white', 'White', '#e8e4da', ['white brick', 'whitewash', 'off white']),
    c('brick', 'cream', 'Cream', '#d9c9a3', ['creme', 'pale cream', 'ivory']),
    c('brick', 'sand', 'Sand', '#c9ae86', ['buff', 'tan', 'sandstone', 'beige']),
    c('brick', 'honey', 'Honey', '#c4975e', ['golden', 'yellow', 'gold']),
    c('brick', 'terracotta', 'Terracotta', '#b35a3c', ['orange', 'clay', 'burnt orange']),
    c('brick', 'red', 'Red', '#9c3e32', ['traditional red', 'classic red', 'brick red']),
    c('brick', 'brown', 'Brown', '#6e4a38', ['mid brown', 'chestnut']),
    c('brick', 'chocolate', 'Chocolate', '#4a3228', ['dark brown', 'espresso', 'coffee']),
    c('brick', 'charcoal', 'Charcoal', '#4a4a4c', ['dark grey', 'anthracite', 'dark gray', 'graphite']),
    c('brick', 'blue-grey', 'Blue Grey', '#7c868c', ['bluestone', 'blue metal', 'slate blue']),
  ],
  // Render, weatherboard, claddings, concrete walls and internal paint.
  paint: [
    c('paint', 'white', 'White', '#f4f3ef', ['pure white', 'bright white', 'vivid white', 'brilliant white']),
    c('paint', 'warm-white', 'Warm White', '#ede8da', ['natural white', 'antique white', 'whisper white', 'lexicon', 'off white', 'ivory']),
    c('paint', 'cream', 'Cream', '#e6d9b8', ['buttermilk', 'vanilla', 'creme']),
    c('paint', 'sand', 'Sand', '#d3c3a2', ['beige', 'putty', 'stone', 'biscuit']),
    c('paint', 'light-grey', 'Light Grey', '#c9c9c4', ['pale grey', 'silver', 'light gray']),
    c('paint', 'mid-grey', 'Mid Grey', '#9a9c9a', ['grey', 'gray', 'concrete grey', 'medium grey']),
    c('paint', 'charcoal', 'Charcoal', '#3f4042', ['dark grey', 'dark gray', 'anthracite', 'monument']),
    c('paint', 'black', 'Black', '#1f2022', ['jet black', 'matt black', 'ink']),
    c('paint', 'sage', 'Sage', '#a8b49c', ['soft green', 'pale green', 'eucalypt', 'light green']),
    c('paint', 'sky', 'Sky Blue', '#a9bfcc', ['pale blue', 'light blue', 'powder blue', 'blue']),
    c('paint', 'navy', 'Navy', '#2f3f55', ['dark blue', 'deep blue', 'midnight']),
    c('paint', 'terracotta', 'Terracotta', '#b7694a', ['clay', 'rust orange', 'burnt orange']),
    c('paint', 'butter', 'Butter Yellow', '#e7d28c', ['yellow', 'pale yellow', 'lemon']),
    c('paint', 'olive', 'Olive', '#6b7050', ['moss', 'khaki green', 'dark green']),
  ],
  stone: [
    c('stone', 'sandstone', 'Sandstone', '#c8ae84', ['sand stone', 'yellow stone', 'sydney sandstone']),
    c('stone', 'limestone', 'Limestone', '#d8cfb8', ['cream stone', 'travertine', 'pale stone']),
    c('stone', 'granite', 'Granite Grey', '#8e8e8c', ['granite', 'grey stone', 'gray stone']),
    c('stone', 'bluestone', 'Bluestone', '#5e6b76', ['blue stone', 'basalt', 'dark grey stone']),
    c('stone', 'rustic-brown', 'Rustic Brown', '#7b5a45', ['brown stone', 'rust stone', 'ironstone']),
  ],
  // Roof tiles.
  tile: [
    c('tile', 'terracotta', 'Terracotta', '#b5573a', ['terracotta', 'orange', 'clay', 'traditional']),
    c('tile', 'red', 'Red', '#9a3b2c', ['brick red', 'dark red']),
    c('tile', 'brown', 'Brown', '#6b4b3a', ['chocolate', 'dark brown']),
    c('tile', 'charcoal', 'Charcoal', '#3c3d3f', ['dark grey', 'dark gray', 'anthracite', 'monument']),
    c('tile', 'slate', 'Slate', '#5d6166', ['slate grey', 'dark slate']),
    c('tile', 'grey', 'Grey', '#8b8d8e', ['light grey', 'silver', 'gray', 'mid grey']),
    c('tile', 'sandstone', 'Sandstone', '#b9a27e', ['sand', 'buff', 'beige']),
    c('tile', 'black', 'Black', '#232426', ['jet black', 'matt black']),
  ],
  // Floors: timber, tile, carpet, polished concrete, vinyl and decking all share this palette.
  floor: [
    c('floor', 'natural-oak', 'Natural Oak', '#c8a56f', ['oak', 'light timber', 'blonde timber', 'natural timber']),
    c('floor', 'blackbutt', 'Blackbutt', '#d2aa6e', ['honey timber', 'golden timber']),
    c('floor', 'spotted-gum', 'Spotted Gum', '#a56f44', ['spotty', 'mid timber', 'medium timber']),
    c('floor', 'jarrah', 'Jarrah', '#7b3f2a', ['red timber', 'reddish timber']),
    c('floor', 'walnut', 'Walnut', '#5b4030', ['dark timber', 'dark brown', 'chocolate', 'espresso']),
    c('floor', 'whitewash', 'Whitewash', '#e4dac6', ['white oak', 'limed oak', 'pale timber', 'scandi', 'bleached']),
    c('floor', 'silver-grey', 'Silver Grey', '#9b9893', ['weathered grey', 'grey timber', 'driftwood', 'grey', 'gray']),
    c('floor', 'charcoal', 'Charcoal', '#4b4c4e', ['dark grey', 'dark gray', 'anthracite', 'black']),
    c('floor', 'concrete', 'Concrete', '#a9a8a4', ['polished concrete', 'raw concrete', 'cement', 'slab']),
    c('floor', 'white', 'White', '#e9e8e3', ['bright white', 'white tile']),
    c('floor', 'sand', 'Sand', '#d1c2a5', ['beige', 'travertine', 'limestone', 'cream']),
    c('floor', 'oatmeal', 'Oatmeal', '#cdbfa9', ['carpet beige', 'cream carpet', 'light carpet', 'wheat']),
    c('floor', 'terracotta', 'Terracotta', '#b46a48', ['clay', 'orange', 'rustic']),
    c('floor', 'merbau', 'Merbau', '#6c3c25', ['deck brown', 'dark red', 'decking brown']),
  ],
  // Window and door frames (steel colours are accepted too).
  frame: [
    c('frame', 'black', 'Black', '#1e1f21', ['matt black', 'night sky', 'jet black', 'dark']),
    c('frame', 'white', 'White', '#f0efea', ['classic white', 'bright white', 'off white']),
    c('frame', 'charcoal', 'Charcoal', '#3b3c3e', ['monument', 'dark grey', 'dark gray', 'anthracite']),
    c('frame', 'silver', 'Silver', '#b5b7b8', ['anodised', 'natural anodised', 'aluminium', 'mill finish', 'grey']),
    c('frame', 'bronze', 'Bronze', '#5c4a3a', ['dark bronze', 'duranodic', 'brown', 'pearl bronze']),
    c('frame', 'sand', 'Sand', '#a59d8c', ['dune', 'champagne', 'beige', 'taupe']),
    c('frame', 'timber', 'Timber', '#8b5e3c', ['wood', 'oak look', 'timber look', 'woodgrain']),
    c('frame', 'green', 'Heritage Green', '#2e4a3a', ['dark green', 'cottage green', 'forest green']),
  ],
};

export const PALETTES = Object.keys(COLOURS);
export const ALL_COLOURS = PALETTE_ORDER.flatMap((p) => COLOURS[p]);

const MATERIAL_BY_ID = new Map(MATERIALS.map((x) => [x.id, x]));
const COLOUR_BY_ID = new Map(ALL_COLOURS.map((x) => [x.id, x]));

export const getMaterial = (id) => MATERIAL_BY_ID.get(id) || null;
export const getColour = (id) => COLOUR_BY_ID.get(id) || null;

// ---------------------------------------------------------------------------------------------
// Targets.
// ---------------------------------------------------------------------------------------------
export const TARGETS = ['external_walls', 'internal_walls', 'roof', 'fascia', 'frames', 'floors'];
const TARGET_KEYS = { externalWalls: 'external_walls', internalWalls: 'internal_walls' };
const TARGET_LABELS = {
  external_walls: 'external walls', internal_walls: 'internal walls', roof: 'the roof',
  fascia: 'the fascia', frames: 'window and door frames', floors: 'floors',
};

function normTarget(t) {
  const s = String(t ?? '');
  return TARGET_KEYS[s] || s;
}

// Materials that suit a target. Fascia and frames are colour only, so they return [].
export function materialsFor(target) {
  switch (normTarget(target)) {
    case 'external_walls':
      return MATERIALS.filter((x) => x.targets.includes('wall') && x.id !== 'paint');
    case 'internal_walls': {
      const wall = MATERIALS.filter((x) => x.targets.includes('wall'));
      return [...wall.filter((x) => x.id === 'paint'), ...wall.filter((x) => x.id !== 'paint')];
    }
    case 'roof':
      return MATERIALS.filter((x) => x.targets.includes('roof'));
    case 'floors':
      return MATERIALS.filter((x) => x.targets.includes('floor'));
    default:
      return [];
  }
}

// Palette names a target can use when no material is given.
function palettesForTarget(target) {
  switch (normTarget(target)) {
    case 'fascia':
      return ['steel'];
    case 'frames':
      return ['frame', 'steel'];
    case 'external_walls':
    case 'internal_walls':
    case 'roof':
    case 'floors':
      return [...new Set(materialsFor(target).map((x) => x.palette))];
    default:
      return [];
  }
}

// Colours for a material id, a palette name, or a target name.
export function coloursFor(materialIdOrTarget) {
  const key = String(materialIdOrTarget ?? '');
  const mat = getMaterial(key);
  if (mat) return COLOURS[mat.palette];
  if (COLOURS[key]) return COLOURS[key];
  return palettesForTarget(key).flatMap((p) => COLOURS[p]);
}

// A sensible colour when only the material changes.
const DEFAULT_COLOUR = {
  brick: 'brick-light-grey', render: 'paint-warm-white', weatherboard: 'paint-white',
  vertical_cladding: 'paint-charcoal', grooved_cladding: 'paint-warm-white', stone: 'stone-sandstone',
  concrete: 'paint-light-grey', corrugated: 'steel-charcoal', trimdek: 'steel-charcoal',
  standing_seam: 'steel-charcoal', paint: 'paint-white', concrete_tile: 'tile-charcoal',
  terracotta_tile: 'tile-terracotta', timber: 'floor-natural-oak', tile: 'floor-white',
  carpet: 'floor-oatmeal', polished_concrete: 'floor-concrete', vinyl: 'floor-natural-oak',
  decking: 'floor-spotted-gum',
};
export const defaultColour = (materialId) => DEFAULT_COLOUR[materialId] || null;

// ---------------------------------------------------------------------------------------------
// Fuzzy colour lookup by id, name or alias.
// ---------------------------------------------------------------------------------------------
const words = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const FILLER = new Set(['colour', 'color', 'colored', 'coloured', 'matt', 'matte', 'gloss', 'satin', 'finish', 'roof', 'roofing', 'wall', 'walls', 'the', 'a', 'an', 'in', 'to', 'of', 'make', 'it']);

function scoreColour(q, qTokens, col) {
  const slug = words(col.id.slice(col.palette.length + 1));
  const name = words(col.name);
  const cands = [[words(col.id), 100], [slug, 92], [name, 92], ...col.aliases.map((a) => [words(a), 86])];
  let best = 0;
  for (const [s, base] of cands) {
    if (!s) continue;
    if (q === s) best = Math.max(best, base);
    else if ((` ${q} `).includes(` ${s} `)) best = Math.max(best, 60 + 20 * (s.length / q.length));
    else if ((` ${s} `).includes(` ${q} `)) best = Math.max(best, 50 + 20 * (q.length / s.length));
  }
  if (best < 50 && qTokens.length) {
    const have = new Set([...slug.split(' '), ...name.split(' '), ...col.aliases.flatMap((a) => words(a).split(' '))]);
    const hit = qTokens.filter((t) => have.has(t)).length;
    if (hit) best = Math.max(best, 40 * (hit / qTokens.length));
  }
  return best;
}

function paletteList(palette) {
  if (!palette) return ALL_COLOURS;
  if (Array.isArray(palette)) return palette.flatMap((p) => coloursFor(p));
  const list = coloursFor(palette);
  return list.length ? list : ALL_COLOURS;
}

// findColour('monument') -> steel-charcoal. Optional palette (name, material id, target or array) narrows the search.
export function findColour(text, palette) {
  const q = words(text);
  if (!q) return null;
  const qTokens = q.split(' ').filter((t) => !FILLER.has(t));
  const pool = paletteList(palette);
  let best = null;
  let bestScore = 0;
  for (const col of pool) {
    const s = scoreColour(q, qTokens, col);
    if (s > bestScore) {
      best = col; // ties keep the earlier colour in the pool, so the palette order sets priority
      bestScore = s;
    }
  }
  return bestScore >= 30 ? best : null;
}

// Nearest swatch to a hex colour, for mapping arbitrary colours onto the catalogue.
export function nearestColour(hex, palette) {
  const h = String(hex).replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  const rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  let best = null;
  let bestD = Infinity;
  for (const col of paletteList(palette)) {
    const d = [0, 2, 4].reduce((s, i, k) => s + (parseInt(col.hex.slice(1 + i, 3 + i), 16) - rgb[k]) ** 2, 0);
    if (d < bestD) {
      bestD = d;
      best = col;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// Validation. Throws Error with a short helpful message; returns true when fine.
// ---------------------------------------------------------------------------------------------
const idList = (list, n = 6) => list.slice(0, n).map((x) => x.id).join(', ') + (list.length > n ? ', ...' : '');

export function validateFinish(target, material, colour) {
  const t = normTarget(target);
  if (!TARGETS.includes(t)) throw new Error(`Unknown finish target "${target}". Use ${TARGETS.join(', ')}.`);
  const label = TARGET_LABELS[t];
  const hasMaterial = material !== undefined && material !== null && material !== '';
  const hasColour = colour !== undefined && colour !== null && colour !== '';
  let mat = null;
  if (hasMaterial) {
    if (t === 'fascia' || t === 'frames') throw new Error(`${t === 'fascia' ? 'Fascia is' : 'Window and door frames are'} colour only. Leave the material out.`);
    mat = getMaterial(material);
    if (!mat) {
      const near = materialsFor(t).map((x) => x.id).join(', ');
      throw new Error(`Unknown material "${material}". For ${label} use: ${near}.`);
    }
    if (t === 'external_walls' && mat.id === 'paint') throw new Error('Paint is for internal walls only. For external walls use render, brick, cladding and so on.');
    if (!materialsFor(t).some((x) => x.id === mat.id)) {
      throw new Error(`${mat.name} does not suit ${label}. Use: ${materialsFor(t).map((x) => x.id).join(', ')}.`);
    }
  }
  if (hasColour) {
    const col = getColour(colour);
    if (!col) {
      const guess = findColour(colour, mat ? mat.palette : t);
      throw new Error(`Unknown colour "${colour}".${guess ? ` Did you mean ${guess.id} (${guess.name})?` : ''}`);
    }
    if (mat) {
      if (col.palette !== mat.palette) {
        throw new Error(`Colour ${col.id} is not available for ${mat.name.toLowerCase()}. Use one of: ${idList(COLOURS[mat.palette])}.`);
      }
    } else if (!palettesForTarget(t).includes(col.palette)) {
      throw new Error(`Colour ${col.id} does not suit ${label}. Use one of: ${idList(coloursFor(t))}.`);
    }
  }
  return true;
}
