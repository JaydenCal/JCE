// The one table of heights above the finished design surface (FDS, see fds.js). Every 3D surface that sits on the ground is built at
// fds.levelAt(x, y) plus an entry from this table, never at a height of its own, so asphalt, concrete, kerbs, paths, beds, paint and cars
// all agree with each other and with the ground under them. Metres. No other file holds a lift or an offset (tests/fds.test.mjs checks).

export const LIFT = Object.freeze({
  asphalt: 0, // carriageway, car park and aisle asphalt: the FDS itself
  concrete: 0, // concrete aprons, footpaths, driveways, forecourts: the FDS itself
  gutter: 0, // the concrete gutter: the FDS itself (its level is the gutter invert)
  paint: 0.003, // road and bay markings, 3 mm proud of the surface they are on
  bed: -0.025, // landscape bed (mulch): 25 mm below the top of the kerb or footpath beside it
  cars: 0, // wheels stand on the FDS
  edgeLine: 0.003, // fine edge line on a drawn way
  mulchRaised: 0.03, // mulch bed on open ground (no kerb beside it): sits just proud of the lawn
});

// Kerb and verge cross section (metres). The kerb top is KERB_UP above the gutter invert; the verge and footpath rise from the back of the
// kerb to the property line at VERGE_RISE (a fall of 2.5 percent to the kerb).
export const KERB_UP = 0.15;
export const KERB_WIDTH = 0.34; // the roll top profile, from the kerb face back towards the property
export const VERGE_RISE = 0.025;
// Roll top profile across the kerb: [metres back from the kerb face, height above the gutter invert]. The top is KERB_UP.
export const KERB_PROFILE = Object.freeze([[0, 0.015], [0.015, 0.1], [0.06, 0.145], [0.13, 0.155], [0.2, 0.14], [0.25, 0.09], [0.3, 0.045], [0.34, 0.03]]);
// A dropped kerb (layback) falls to the gutter lip.
export const KERB_LAYBACK_LIP = 0.015;

// Where a level is blended (not stepped) between two design elements: the transition width in metres, and a short one beside a crossover.
export const TRANSITION_M = 2.0;
export const TRANSITION_WING_M = 1.0;

// The terrain mesh sits this far under paved, road and pad surfaces, so a coarse mesh triangle can never poke through the surface on top
// of it (the surface itself is exact, from the FDS). Gone in Phase 2, where the mesh is cut along every element edge.
export const SUBGRADE = 0.03;
// Under the road corridor the mesh is buried much deeper (its kerb, gutter and verge are exact strips, see site-extras.js), fading back to the
// SUBGRADE depth over one terrain cell at the corridor's edges so the ground beside it stays flat.
export const ROAD_BURY = 0.4;

export const lift = (key) => LIFT[key] ?? 0;
