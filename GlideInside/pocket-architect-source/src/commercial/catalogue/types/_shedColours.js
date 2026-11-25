// Wall cladding colours offered for sheds. Named in the style of the common Australian steel cladding colour ranges; the hex values are
// approximate screen colours, not a manufacturer match. The default is a pale grey (the usual shed builder drawing), never a warm or orange tone.
export const SHED_COLOURS = Object.freeze([
  { id: 'pale-grey', name: 'Pale grey', hex: '#cfd2d1' },
  { id: 'surfmist', name: 'Surfmist', hex: '#e6e3d6' },
  { id: 'shale-grey', name: 'Shale Grey', hex: '#bdbfb7' },
  { id: 'classic-cream', name: 'Classic Cream', hex: '#e8dcb8' },
  { id: 'dune', name: 'Dune', hex: '#b2ab9a' },
  { id: 'pale-eucalypt', name: 'Pale Eucalypt', hex: '#8f9c82' },
  { id: 'basalt', name: 'Basalt', hex: '#6d6c6e' },
  { id: 'woodland-grey', name: 'Woodland Grey', hex: '#4d5148' },
  { id: 'monument', name: 'Monument', hex: '#323233' },
]);
export const DEFAULT_SHED_COLOUR = 'pale-grey';
export const shedColourById = (id) => SHED_COLOURS.find((c) => c.id === id) || SHED_COLOURS[0];
export const SHED_COLOUR_OPTIONS = SHED_COLOURS.map((c) => ({ value: c.id, label: c.name }));
