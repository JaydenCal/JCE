// Original demonstration floor plan (not a real property).
// Units: metres. Plan coordinates: x to the east, y down the page.
// North points DOWN the page (towards the balcony), so living and balcony face north.

export const PLAN = {
  title: 'Sample apartment',
  facts: { beds: 2, baths: 2, internal: 96, balcony: 12, total: 108 },
  wallHeight: 2.7,
  doorHeight: 2.1,
  envelope: { w: 12.0, d: 8.0 },

  rooms: [
    { id: 'bed2', name: 'BED 2', dims: '3.4 x 3.0', floor: 'carpet', label: [1.25, 2.45],
      poly: [[0, 0], [3.4, 0], [3.4, 3.0], [0, 3.0]] },
    { id: 'bath', name: 'BATH', dims: '2.4 x 3.0', floor: 'tile', label: [4.46, 1.08],
      poly: [[3.4, 0], [5.8, 0], [5.8, 3.0], [3.4, 3.0]] },
    { id: 'entry', name: 'ENTRY', dims: '', floor: 'timber', label: [7.0, 2.35],
      poly: [[5.8, 0], [7.6, 0], [7.6, 3.0], [5.8, 3.0]] },
    { id: 'kitchen', name: 'KITCHEN', dims: '4.4 x 3.0', floor: 'timber', label: [9.6, 1.25],
      poly: [[7.6, 0], [12, 0], [12, 3.0], [7.6, 3.0]] },
    { id: 'hall', name: '', dims: '', floor: 'timber',
      poly: [[2.2, 3.0], [5.8, 3.0], [5.8, 4.1], [2.2, 4.1]] },
    { id: 'ens', name: 'ENS', dims: '', floor: 'tile', label: [1.12, 4.42],
      poly: [[0, 3.0], [2.2, 3.0], [2.2, 5.4], [0, 5.4]] },
    { id: 'bed1', name: 'BED 1', dims: '4.4 x 3.9', floor: 'carpet', label: [1.2, 7.05],
      poly: [[2.2, 4.1], [4.4, 4.1], [4.4, 8.0], [0, 8.0], [0, 5.4], [2.2, 5.4]] },
    { id: 'living', name: 'LIVING', dims: '7.6 x 5.0', floor: 'timber', label: [9.3, 7.42],
      poly: [[5.8, 3.0], [12, 3.0], [12, 8.0], [4.4, 8.0], [4.4, 4.1], [5.8, 4.1]] },
    { id: 'balcony', name: 'BALCONY', dims: '5.0 x 2.4', floor: 'deck', label: [9.6, 9.95], outdoor: true,
      poly: [[6.6, 8.0], [11.6, 8.0], [11.6, 10.4], [6.6, 10.4]] },
  ],
  extraLabels: [{ name: 'DINING', at: [6.2, 6.75] }],

  // Walls run from a to b. Openings are measured along the wall from a.
  // Door: hinge 'from' or 'to' end; side +1 swings to the left normal of a->b, -1 to the right.
  walls: [
    { a: [0, 0], b: [12, 0], t: 0.25, ext: true, openings: [
      { from: 6.3, to: 7.2, type: 'door', id: 'entry', hinge: 'to', side: 1, open: 106 } ] },
    { a: [0, 8], b: [12, 8], t: 0.25, ext: true, openings: [
      { from: 1.0, to: 3.4, type: 'window', sill: 0.45, head: 2.4 },
      { from: 4.8, to: 6.4, type: 'window', sill: 0.45, head: 2.4 },
      { from: 7.0, to: 11.2, type: 'slider', sill: 0, head: 2.4, openFrom: 7.0, openTo: 9.1 } ] },
    { a: [0, 0], b: [0, 8], t: 0.25, ext: true, openings: [
      { from: 0.7, to: 2.3, type: 'window', sill: 0.9, head: 2.1 },
      { from: 3.5, to: 4.4, type: 'window', sill: 1.5, head: 2.1, obscure: true },
      { from: 6.0, to: 7.4, type: 'window', sill: 0.9, head: 2.1 } ] },
    { a: [12, 0], b: [12, 8], t: 0.25, ext: true, openings: [] },

    { a: [3.4, 0], b: [3.4, 3.0], t: 0.12, openings: [] },
    { a: [5.8, 0], b: [5.8, 3.0], t: 0.12, openings: [] },
    { a: [7.6, 0], b: [7.6, 2.0], t: 0.12, openings: [] },
    { a: [0, 3.0], b: [5.8, 3.0], t: 0.12, openings: [
      { from: 2.4, to: 3.2, type: 'door', id: 'bed2', hinge: 'to', side: -1 },
      { from: 4.0, to: 4.8, type: 'door', id: 'bath', hinge: 'to', side: -1 } ] },
    { a: [2.2, 3.0], b: [2.2, 5.4], t: 0.12, openings: [
      { from: 1.4, to: 2.1, type: 'door', id: 'ens', hinge: 'to', side: 1 } ] },
    { a: [2.2, 4.1], b: [4.4, 4.1], t: 0.12, openings: [
      { from: 1.25, to: 2.05, type: 'door', id: 'bed1', hinge: 'to', side: 1 } ] },
    { a: [4.4, 4.1], b: [4.4, 8.0], t: 0.12, openings: [] },
    { a: [0, 5.4], b: [2.2, 5.4], t: 0.12, openings: [] },
  ],

  // Furniture: rect [x0, y0, x1, y1] in plan metres.
  furniture: [
    // Bed 2
    { type: 'bed', rect: [0.9, 0.12, 2.3, 2.02], head: 'n', size: 'double' },
    { type: 'bedside', rect: [0.42, 0.14, 0.84, 0.54] },
    { type: 'bedside', rect: [2.36, 0.14, 2.74, 0.54] },
    { type: 'robe', rect: [2.79, 0.12, 3.34, 1.92], front: 'w' },
    // Bathroom
    { type: 'bath', rect: [3.47, 0.13, 5.17, 0.85] },
    { type: 'vanity', rect: [3.47, 1.1, 3.97, 2.0], front: 'e' },
    { type: 'toilet', rect: [3.47, 2.3, 4.15, 2.72], front: 'e' },
    { type: 'shower', rect: [4.95, 1.15, 5.73, 2.1], open: ['w', 's'] },
    // Entry
    { type: 'robe', rect: [5.87, 0.5, 6.47, 2.0], front: 'e', label: 'LDRY' },
    // Kitchen
    { type: 'bench', rect: [7.72, 0.13, 11.13, 0.75], front: 's', sink: [8.9, 0.44], cooktop: [10.25, 0.44] },
    { type: 'overhead', rect: [7.72, 0.13, 11.13, 0.48] },
    { type: 'fridge', rect: [11.2, 0.13, 11.88, 0.85], front: 's' },
    { type: 'island', rect: [8.4, 1.85, 10.8, 2.75] },
    { type: 'stool', at: [8.95, 3.05] }, { type: 'stool', at: [9.6, 3.05] }, { type: 'stool', at: [10.25, 3.05] },
    { type: 'pendant', at: [8.95, 2.3], drop: 0.85 }, { type: 'pendant', at: [9.6, 2.3], drop: 0.85 }, { type: 'pendant', at: [10.25, 2.3], drop: 0.85 },
    // Living and dining
    { type: 'rug', rect: [8.0, 4.05, 11.2, 6.9] },
    { type: 'sofa', rect: [8.3, 4.3, 9.25, 6.6], front: 'e' },
    { type: 'coffee', rect: [9.75, 5.0, 10.55, 5.9] },
    { type: 'tvunit', rect: [11.42, 4.45, 11.87, 6.45], front: 'w' },
    { type: 'armchair', rect: [10.2, 6.9, 10.95, 7.6], front: 'n' },
    { type: 'lamp', at: [8.45, 6.95] },
    { type: 'table', rect: [5.3, 4.65, 7.1, 5.6] },
    { type: 'chair', at: [5.75, 4.42], front: 's' }, { type: 'chair', at: [6.65, 4.42], front: 's' },
    { type: 'chair', at: [5.75, 5.83], front: 'n' }, { type: 'chair', at: [6.65, 5.83], front: 'n' },
    { type: 'chair', at: [5.05, 5.12], front: 'e' }, { type: 'chair', at: [7.35, 5.12], front: 'w' },
    { type: 'pendant', at: [6.2, 5.12], drop: 1.0, wide: true },
    { type: 'plant', at: [11.6, 7.55], scale: 1.1 }, { type: 'plant', at: [4.75, 7.62], scale: 0.9 },
    // Bed 1
    { type: 'bed', rect: [2.3, 5.73, 4.33, 7.26], head: 'e', size: 'queen' },
    { type: 'bedside', rect: [3.9, 5.25, 4.33, 5.68] },
    { type: 'bedside', rect: [3.9, 7.31, 4.33, 7.74] },
    { type: 'robe', rect: [0.12, 5.46, 2.15, 6.06], front: 's' },
    { type: 'plant', at: [0.42, 7.58], scale: 0.85 },
    // Ensuite
    { type: 'shower', rect: [0.13, 3.07, 1.05, 4.0], open: ['e', 's'] },
    { type: 'vanity', rect: [1.62, 3.08, 2.14, 4.08], front: 'w' },
    { type: 'toilet', rect: [0.13, 4.55, 0.81, 4.97], front: 'e' },
    // Balcony
    { type: 'outtable', at: [7.4, 9.3] },
    { type: 'outchair', at: [6.95, 9.3], front: 'e' }, { type: 'outchair', at: [7.85, 9.3], front: 'w' },
    { type: 'armchair', rect: [10.15, 8.85, 10.9, 9.6], front: 'w', outdoor: true },
    { type: 'planter', rect: [6.75, 9.98, 7.95, 10.3] },
    { type: 'planter', rect: [10.3, 9.98, 11.5, 10.3] },
  ],
};
