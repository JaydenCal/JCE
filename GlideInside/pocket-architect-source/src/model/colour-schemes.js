// Preset colour schemes (roof, walls, trim) for a placed house. The choice is stored in the project (project.colourScheme, a scheme
// id) so save and share links, the 3D view, the plan and every export show the same colours. Pure: no DOM, no three.js.
//
//   effectiveSchemeId(project)               the scheme in force: the saved choice, else Standard colours once a lot is on the design
//   applySchemeToFinishes(finishes, id)      a copy of the finishes (walls, roof, fascia) with the scheme colours laid over them
//   schemeColours(project)                   { roof, wall, trim } hex for the plan and the minimap, or null

export const DEFAULT_SCHEME_ID = 'standard';

// Standard colours: a dark charcoal roof and gutters. Walls stay as the house design has them (wall null).
export const SCHEMES = Object.freeze([
  { id: 'standard', name: 'Standard colours', roof: '#42474c', roofName: 'Charcoal', wall: null, wallName: 'Design walls', trim: '#42474c' },
  { id: 'monument-shale', name: 'Monument and Shale', roof: '#42474c', roofName: 'Monument', wall: '#d2cabb', wallName: 'Shale', trim: '#42474c' },
  { id: 'nightsky-white', name: 'Night Sky and White', roof: '#2b2d30', roofName: 'Night Sky', wall: '#f1efe9', wallName: 'White', trim: '#2b2d30' },
  { id: 'woodland-dune', name: 'Woodland and Dune', roof: '#4d4d4a', roofName: 'Woodland Grey', wall: '#a69a85', wallName: 'Dune', trim: '#4d4d4a' },
  { id: 'basalt-surfmist', name: 'Basalt and Surfmist', roof: '#6d6e70', roofName: 'Basalt', wall: '#e7e5dc', wallName: 'Surfmist', trim: '#6d6e70' },
  { id: 'bluestone-grey', name: 'Bluestone and Grey', roof: '#3f444a', roofName: 'Deep Ocean', wall: '#7c868c', wallName: 'Blue Grey', trim: '#3f444a' },
  { id: 'terrain-cream', name: 'Terrain and Cream', roof: '#5c5247', roofName: 'Terrain', wall: '#d8c9a6', wallName: 'Cream', trim: '#5c5247' },
  { id: 'ironstone-brick', name: 'Ironstone and Brick', roof: '#4b4a47', roofName: 'Ironstone', wall: '#9b5a43', wallName: 'Red Brick', trim: '#e8e6df' },
]);

export const schemeById = (id) => SCHEMES.find((s) => s.id === id) || null;

/** One line for the card: "Monument roof, Shale walls", or "Standard colours". */
export const schemeLine = (s) => (!s || s.id === DEFAULT_SCHEME_ID ? 'Standard colours' : `${s.roofName} roof, ${s.wallName} walls`);

/** The saved choice if it names a real scheme, else Standard colours when a lot is on the design, else null (design as drawn). */
export function effectiveSchemeId(project) {
  const saved = project?.colourScheme;
  if (saved && schemeById(saved)) return saved;
  return project?.site?.lot ? DEFAULT_SCHEME_ID : null;
}

export function applySchemeToFinishes(finishes, id) {
  const s = schemeById(id);
  const out = { ...finishes };
  if (!s) return out;
  out.roof = { ...(finishes.roof || {}), colour: s.roof };
  out.fascia = { ...(finishes.fascia || {}), colour: s.trim };
  if (s.wall) out.externalWalls = { ...(finishes.externalWalls || {}), colour: s.wall };
  return out;
}

/** Hex colours for the 2D plan and the minimap. The wall colour falls back to the design's own external wall colour when given. */
export function schemeColours(project, designWall = null) {
  const s = schemeById(effectiveSchemeId(project));
  if (!s) return null;
  return { roof: s.roof, wall: s.wall || designWall || '#cfc9bd', trim: s.trim, id: s.id };
}
