// The generic design set: narrow lot homes, a starter home, townhouses, a homestead, granny flats, a dual occupancy and a shed house.
// Plain data for buildSpec (generic.js). Coordinates are wall centre lines in mm, north is -y, the street is south.
// Typical proportions and Australian conventions only: garage forward, open plan family and meals at the rear to a roofed
// alfresco, bedrooms off a hall. Nothing here is taken from any builder's plan.

import { R, P, O, D } from './generic.js';

const W = (preset, room, side, at, o) => O(preset, room, side, at, o);

// ---------------------------------------------------------------------------------------------------------------------------
// 1. Narrow lot 10 m, 3 bedroom. 8.2 m wide: 0.9 m each side on a 10 m frontage.
const narrow10 = {
  id: 'narrow_10_3bed',
  name: 'Narrow lot 10 m, 3 bedroom',
  description: 'For a 10 m wide lot (0.9 m each side). Single garage forward, side hall, three bedrooms, open plan kitchen, dining and living to a roofed alfresco, master with walk-in robe and ensuite.',
  frontageM: 10,
  levels: [{
    rooms: [
      R('open', 'family', 'Kitchen, dining and living', 0, 0, 8200, 5600),
      R('alf', 'alfresco', 'Alfresco', 1500, -3000, 6700, 0),
      R('bed3', 'bedroom', 'Bed 3', 0, 5600, 3700, 8800),
      R('bed2', 'bedroom', 'Bed 2', 0, 8800, 3700, 12000),
      R('garage', 'garage', 'Garage', 0, 12000, 3700, 17600),
      R('hall', 'hall', 'Hall', 3700, 5600, 4800, 16800),
      R('bath', 'bathroom', 'Bathroom', 4800, 5600, 8200, 7800),
      R('laundry', 'laundry', 'Laundry', 4800, 7800, 8200, 9400),
      R('ens', 'ensuite', 'Ensuite', 4800, 9400, 8200, 11200),
      P('master', 'bedroom', 'Master', [[4800, 11200], [8200, 11200], [8200, 16800], [6600, 16800], [6600, 15000], [4800, 15000]]),
      R('wir', 'robe', 'Walk-in robe', 4800, 15000, 6600, 16800),
      R('porch', 'verandah', 'Porch', 3700, 16800, 6200, 18000),
    ],
    openings: [
      D('hall', 's', 4250, 'door_entry', 'hall'),
      O('opening_900', 'hall', 'n', 4250),
      D('bed3', 'e', 6400), D('bed2', 'e', 11200),
      D('bath', 'w', 6500), D('laundry', 'w', 8600),
      D('master', 'w', 12600), D('ens', 's', 7500), D('wir', 'e', 15900, 'door_cavity', 'wir'),
      D('garage', 'e', 14500, 'door_internal', 'hall'),
      O('garage_door_2400', 'garage', 's', 1850),
      W('window_awning_1200', 'garage', 'w', 14500),
      W('sliding_door_3000', 'open', 'n', 4100),
      W('window_kitchen_1800', 'open', 'n', 1000),
      W('window_sliding_1800', 'open', 'e', 2800),
      W('window_sliding_1800', 'bed3', 'w', 7200), W('window_sliding_1800', 'bed2', 'w', 10400),
      W('window_awning_1200', 'bath', 'e', 6700), W('window_awning_1200', 'laundry', 'e', 8600),
      W('window_awning_600', 'ens', 'e', 10300),
      W('window_sliding_1800', 'master', 'e', 13000), W('window_sliding_1200', 'master', 's', 7400),
    ],
  }],
  tanks: [[-1200, 9000, 5000]],
  finishes: [['external_walls', 'brick', 'brick-honey']],
};


// ---------------------------------------------------------------------------------------------------------------------------
// 2. Narrow lot 12.5 m, 4 bedroom. 10.0 m wide: 0.9 m and 1.5 m side setbacks leave 10.1 m on a 12.5 m frontage.
const narrow125 = {
  id: 'narrow_125_4bed',
  name: 'Narrow lot 12.5 m, 4 bedroom',
  description: 'For a 12.5 m wide lot (0.9 m and 1.5 m sides). Garage forward, central hall, four bedrooms, a 60 m² open plan living area to a roofed alfresco, and a master with ensuite.',
  frontageM: 12.5,
  levels: [{
    rooms: [
      R('open', 'family', 'Kitchen, dining and living', 0, 0, 10000, 6000),
      R('alf', 'alfresco', 'Alfresco', 2000, -3200, 8000, 0),
      R('bed2', 'bedroom', 'Bed 2', 0, 6000, 4400, 9200),
      R('bed3', 'bedroom', 'Bed 3', 0, 9200, 4400, 12400),
      R('garage', 'garage', 'Garage', 0, 12400, 4400, 18000),
      R('hall', 'hall', 'Hall', 4400, 6000, 5600, 16700),
      R('laundry', 'laundry', 'Laundry', 5600, 6000, 10000, 7500),
      R('bath', 'bathroom', 'Bathroom', 5600, 7500, 10000, 9500),
      R('bed4', 'bedroom', 'Bed 4', 5600, 9500, 10000, 12700),
      P('master', 'bedroom', 'Master', [[5600, 12700], [8000, 12700], [8000, 14500], [10000, 14500], [10000, 16700], [5600, 16700]]),
      R('ens', 'ensuite', 'Ensuite', 8000, 12700, 10000, 14500),
      R('porch', 'verandah', 'Porch', 4400, 16700, 7000, 17900),
    ],
    openings: [
      D('hall', 's', 5000, 'door_entry', 'hall'), O('opening_900', 'hall', 'n', 5000),
      D('bed2', 'e', 8600), D('bed3', 'e', 9900),
      D('laundry', 'w', 6700), D('bath', 'w', 8500), D('bed4', 'w', 10200), D('master', 'w', 14000),
      D('ens', 'w', 13600, 'door_cavity'),
      D('garage', 'e', 14500, 'door_internal', 'hall'),
      O('garage_door_2400', 'garage', 's', 2200), W('window_awning_1200', 'garage', 'w', 15000),
      W('sliding_door_3000', 'open', 'n', 5000), W('window_kitchen_1800', 'open', 'n', 1500),
      W('window_sliding_1800', 'open', 'w', 3000), W('window_sliding_1800', 'open', 'e', 3000),
      W('window_sliding_1800', 'bed2', 'w', 7600), W('window_sliding_1800', 'bed3', 'w', 10800),
      W('window_sliding_1800', 'bed4', 'e', 11100),
      W('window_awning_1200', 'laundry', 'e', 6750), W('window_awning_1200', 'bath', 'e', 8500),
      W('window_sliding_1800', 'master', 'e', 15700), W('window_sliding_1800', 'master', 's', 6800),
      W('window_awning_600', 'ens', 'e', 13600),
    ],
  }],
  roof: { type: 'hip', pitch: 22.5, overhang: 450 },
  tanks: [[-1100, 12000, 5000]],
  finishes: [['external_walls', 'render', 'paint-sand'], ['roof', 'concrete_tile', 'tile-charcoal']],
};

// ---------------------------------------------------------------------------------------------------------------------------
// 3. Narrow lot 14 m, 3 bedroom and media room. 11.6 m wide: 0.9 m and 1.5 m sides leave 11.6 m on a 14 m frontage.
const narrow14 = {
  id: 'narrow_14_3bed_media',
  name: 'Narrow lot 14 m, 3 bedroom and media room',
  description: 'For a 14 m wide lot (0.9 m and 1.5 m sides). Single garage forward, three bedrooms, a media room off the family area, master with walk-in robe and ensuite, and a roofed alfresco.',
  frontageM: 14,
  levels: [{
    rooms: [
      R('open', 'family', 'Kitchen, dining and living', 0, 0, 11600, 6400),
      R('alf', 'alfresco', 'Alfresco', 2600, -3400, 9000, 0),
      R('bed2', 'bedroom', 'Bed 2', 0, 6400, 3800, 9600),
      R('bed3', 'bedroom', 'Bed 3', 0, 9600, 3800, 12800),
      R('garage', 'garage', 'Garage', 0, 12800, 3800, 18200),
      R('hall', 'hall', 'Hall', 3800, 6400, 5000, 16000),
      R('laundry', 'laundry', 'Laundry', 5000, 6400, 7600, 8200),
      R('bath', 'bathroom', 'Bathroom', 5000, 8200, 7600, 10400),
      R('media', 'media', 'Media room', 7600, 6400, 11600, 10400),
      R('master', 'bedroom', 'Master', 5000, 10400, 9000, 14400),
      R('ens', 'ensuite', 'Ensuite', 9000, 10400, 11600, 12400),
      R('wir', 'robe', 'Walk-in robe', 9000, 12400, 11600, 14400),
      R('porch', 'verandah', 'Porch', 3800, 16000, 6400, 17200),
    ],
    openings: [
      D('hall', 's', 4400, 'door_entry', 'hall'), O('opening_900', 'hall', 'n', 4400),
      D('bed2', 'e', 8800), D('bed3', 'e', 10200),
      D('laundry', 'w', 7300), D('bath', 'w', 9300), D('master', 'w', 13200),
      D('ens', 'w', 11400, 'door_cavity'),
      O('opening_1800', 'media', 'n', 9600),
      D('wir', 'w', 13400, 'door_cavity', 'wir'),
      D('garage', 'e', 14800, 'door_internal', 'hall'),
      O('garage_door_2400', 'garage', 's', 1900), W('window_awning_1200', 'garage', 'w', 15000),
      W('sliding_door_3000', 'open', 'n', 5800), W('window_kitchen_1800', 'open', 'n', 1500),
      W('window_sliding_1800', 'open', 'w', 3000), W('window_sliding_1800', 'open', 'e', 3200),
      W('window_sliding_1800', 'bed2', 'w', 8000), W('window_sliding_1800', 'bed3', 'w', 11200),
      W('window_sliding_2400', 'media', 'e', 8400),
      W('window_sliding_1800', 'master', 's', 7000), W('window_awning_600', 'ens', 'e', 11400),
    ],
  }],
  roof: { type: 'hip', pitch: 22.5, overhang: 450 },
  tanks: [[-1100, 13000, 5000]],
  finishes: [['external_walls', 'brick', 'brick-sand'], ['roof', 'corrugated', 'steel-mid-grey']],
};

// ---------------------------------------------------------------------------------------------------------------------------
// 4. Single storey 3 bedroom starter, 12.0 m wide.
const starter = {
  id: 'single_3bed_starter',
  name: 'Single storey, 3 bedroom starter',
  description: 'About 12 m wide. A compact first home: open plan kitchen, dining and living, a separate lounge, three bedrooms, master with walk-in robe and ensuite, laundry, single garage and roofed alfresco.',
  frontageM: 15,
  levels: [{
    rooms: [
      R('open', 'family', 'Kitchen, dining and family', 0, 0, 12000, 5400),
      R('alf', 'alfresco', 'Alfresco', 3000, -3000, 9000, 0),
      R('bed2', 'bedroom', 'Bed 2', 0, 5400, 4200, 8600),
      R('bed3', 'bedroom', 'Bed 3', 0, 8600, 4200, 11800),
      R('garage', 'garage', 'Garage', 0, 11800, 4200, 17200),
      R('hall', 'hall', 'Hall', 4200, 5400, 5400, 14600),
      R('bath', 'bathroom', 'Bathroom', 5400, 5400, 7800, 7800),
      R('laundry', 'laundry', 'Laundry', 5400, 7800, 7800, 9400),
      R('lounge', 'living', 'Lounge', 7800, 5400, 12000, 9400),
      R('master', 'bedroom', 'Master', 5400, 9400, 9600, 13400),
      R('ens', 'ensuite', 'Ensuite', 9600, 9400, 12000, 11400),
      R('wir', 'robe', 'Walk-in robe', 9600, 11400, 12000, 13400),
      R('porch', 'verandah', 'Porch', 4200, 14600, 6800, 15800),
    ],
    openings: [
      D('hall', 's', 4800, 'door_entry', 'hall'), O('opening_900', 'hall', 'n', 4800),
      D('bed2', 'e', 8000), D('bed3', 'e', 9500),
      D('bath', 'w', 6600), D('laundry', 'w', 8600), D('master', 'w', 11800),
      D('ens', 'w', 10400, 'door_cavity'), D('wir', 'w', 12400, 'door_cavity', 'wir'),
      O('opening_1800', 'lounge', 'n', 9900),
      D('garage', 'e', 13200, 'door_internal', 'hall'),
      O('garage_door_2400', 'garage', 's', 2100), W('window_awning_1200', 'garage', 'w', 14500),
      W('sliding_door_3000', 'open', 'n', 6000), W('window_kitchen_1800', 'open', 'n', 1500),
      W('window_sliding_1800', 'open', 'w', 2700), W('window_sliding_1800', 'open', 'e', 2700),
      W('window_sliding_1800', 'bed2', 'w', 7000), W('window_sliding_1800', 'bed3', 'w', 10200),
      W('window_sliding_2400', 'lounge', 'e', 7400),
      W('window_sliding_1800', 'master', 's', 7600), W('window_awning_600', 'ens', 'e', 10400),
    ],
  }],
  roof: { type: 'hip', pitch: 22.5, overhang: 450 },
  tanks: [[-1100, 10000, 5000]],
  finishes: [['external_walls', 'render', 'paint-light-grey'], ['roof', 'corrugated', 'steel-charcoal']],
};

// ---------------------------------------------------------------------------------------------------------------------------
// 5. Narrow double storey, 4 bedroom, 8.8 m wide.
const narrowDouble = {
  id: 'narrow_double_4bed',
  name: 'Narrow double storey, 4 bedroom',
  description: 'About 8.8 m wide, for a lot of 11 m or more. Double garage forward, study, open plan living to an alfresco, a void over the entry, four bedrooms upstairs and a master with walk-in robe, ensuite and balcony.',
  frontageM: 12.5,
  levels: [
    {
      name: 'Ground',
      rooms: [
        R('open', 'family', 'Kitchen, dining and living', 0, 0, 8800, 6400),
        R('alf', 'alfresco', 'Alfresco', 1500, -3000, 7300, 0),
        R('study', 'study', 'Study', 0, 6400, 3600, 10200),
        R('powder', 'wc', 'Powder room', 3600, 6400, 5800, 8200),
        R('laundry', 'laundry', 'Laundry', 3600, 8200, 5800, 10200),
        R('garage', 'garage', 'Garage', 0, 10200, 5800, 15600),
        R('hall', 'hall', 'Entry and stair hall', 5800, 6400, 8800, 15600),
      ],
      openings: [
        D('hall', 's', 6800, 'door_entry', 'hall'), O('opening_1800', 'hall', 'n', 6800, { width: 1400 }),
        D('study', 'n', 1800, 'door_internal', 'study'),
        D('powder', 'e', 7000), D('laundry', 'e', 9200),
        D('garage', 'e', 13000, 'door_internal', 'hall'),
        O('garage_door_4800', 'garage', 's', 2900), W('window_awning_1200', 'garage', 'w', 12900),
        W('sliding_door_3000', 'open', 'n', 4400), W('window_kitchen_1800', 'open', 'n', 1500),
        W('window_sliding_1800', 'open', 'w', 3200), W('window_sliding_1800', 'open', 'e', 3200),
        W('window_sliding_1800', 'study', 'w', 8300), W('window_sliding_1200', 'hall', 'e', 12400),
      ],
      stairs: [[8100, 9400, 1000, 3600, 180]],
    },
    {
      name: 'First',
      rooms: [
        R('bed2', 'bedroom', 'Bed 2', 0, 0, 4400, 3600),
        R('bed3', 'bedroom', 'Bed 3', 4400, 0, 8800, 3600),
        R('bed4', 'bedroom', 'Bed 4', 0, 3600, 3200, 7000),
        P('landing', 'hall', 'Landing and entry void', [[3200, 3600], [8800, 3600], [8800, 11800], [5800, 11800], [5800, 7000], [3200, 7000]]),
        R('ens', 'ensuite', 'Ensuite', 0, 7000, 3000, 9000),
        R('bath', 'bathroom', 'Bathroom', 3000, 7000, 5800, 9000),
        R('master', 'bedroom', 'Master', 0, 9000, 5800, 13400),
        R('wir', 'robe', 'Walk-in robe', 0, 13400, 3000, 15600),
        R('balc', 'deck', 'Balcony', 3000, 13400, 5800, 15600, { balustrade: true }),
      ],
      openings: [
        D('bed2', 's', 3800), D('bed3', 's', 6600), D('bed4', 'e', 5000),
        D('bath', 'n', 4500), D('master', 'e', 10400), D('ens', 's', 1500, 'door_cavity', 'ens'),
        D('wir', 'n', 1500, 'door_cavity', 'wir'),
        W('window_sliding_1800', 'bed2', 'n', 2200), W('window_sliding_1200', 'bed2', 'w', 1800),
        W('window_sliding_1800', 'bed3', 'n', 6600), W('window_sliding_1200', 'bed3', 'e', 1800),
        W('window_sliding_1800', 'bed4', 'w', 5300),
        W('window_sliding_1800', 'master', 'w', 11200), O('sliding_door_2400', 'master', 's', 4400),
        W('window_awning_600', 'ens', 'w', 8000),
      ],
    },
  ],
  roof: { type: 'hip', pitch: 22.5, overhang: 450 },
  tanks: [[-1100, 9000, 5000]],
  finishes: [['external_walls', 'render', 'paint-warm-white'], ['roof', 'corrugated', 'steel-slate']],
};


// ---------------------------------------------------------------------------------------------------------------------------
// 6. Townhouse, 3 bedroom, 2 storey, 6.5 m wide.
const townhouse = {
  id: 'townhouse_3bed',
  name: 'Townhouse, 3 bedroom, two storey',
  description: 'A 6.5 m wide two storey townhouse for a 7.5 m or 8.5 m lot. Single garage, open plan living to a courtyard, powder room and laundry downstairs, three bedrooms, bathroom and an ensuite to the master upstairs.',
  frontageM: 8.5,
  levels: [
    {
      name: 'Ground',
      rooms: [
        R('open', 'family', 'Kitchen, dining and living', 0, 0, 6500, 5600),
        R('alf', 'alfresco', 'Courtyard', 800, -2800, 5700, 0, { roofed: false }),
        R('laundry', 'laundry', 'Laundry', 0, 5600, 3400, 7200),
        R('powder', 'wc', 'Powder room', 0, 7200, 3400, 9000),
        R('garage', 'garage', 'Garage', 0, 9000, 3400, 14600),
        R('hall', 'hall', 'Entry and stair hall', 3400, 5600, 6500, 14600),
      ],
      openings: [
        D('hall', 's', 4900, 'door_entry', 'hall'), O('opening_1800', 'hall', 'n', 4300, { width: 1400 }),
        D('laundry', 'e', 6400), D('powder', 'e', 8100),
        D('garage', 'e', 12000, 'door_internal', 'hall'), O('garage_door_2400', 'garage', 's', 1700),
        W('sliding_door_2100', 'open', 'n', 4800), W('window_kitchen_1800', 'open', 'n', 1300),
        W('window_sliding_1800', 'open', 'w', 2800), W('window_sliding_1800', 'open', 'e', 2800),
        W('window_awning_1200', 'laundry', 'w', 6400), W('window_awning_600', 'powder', 'w', 8100),
        W('window_sliding_1200', 'hall', 'e', 12000),
      ],
      stairs: [[6000, 8000, 1000, 3600, 180]],
      keepClear: [[5400, 6200, 6500, 9800]],
    },
    {
      name: 'First',
      rooms: [
        R('bed2', 'bedroom', 'Bed 2', 0, 0, 3300, 3800),
        R('bed3', 'bedroom', 'Bed 3', 3300, 0, 6500, 3800),
        R('bath', 'bathroom', 'Bathroom', 0, 3800, 2000, 6200),
        P('landing', 'hall', 'Landing and entry void', [[2000, 3800], [6500, 3800], [6500, 11000], [3400, 11000], [3400, 6200], [2000, 6200]]),
        R('ens', 'ensuite', 'Ensuite', 0, 6200, 3400, 8600),
        R('master', 'bedroom', 'Master', 0, 8600, 3400, 14600),
      ],
      openings: [
        D('bed2', 's', 2650), D('bed3', 's', 4900), D('bath', 'e', 5000),
        D('master', 'e', 9800), D('ens', 's', 1700, 'door_cavity', 'ens'),
        W('window_sliding_1800', 'bed2', 'n', 1650), W('window_sliding_1200', 'bed2', 'w', 1900),
        W('window_sliding_1800', 'bed3', 'n', 4900), W('window_sliding_1200', 'bed3', 'e', 1900),
        W('window_sliding_1800', 'master', 'w', 11500), W('window_sliding_1800', 'master', 's', 1700),
        W('window_awning_600', 'ens', 'w', 7400), W('window_awning_600', 'bath', 'w', 5000),
      ],
    },
  ],
  roof: { type: 'skillion', pitch: 8, overhang: 450 },
  finishes: [['external_walls', 'render', 'paint-mid-grey'], ['roof', 'standing_seam', 'steel-charcoal']],
};

// ---------------------------------------------------------------------------------------------------------------------------
// 7. Dual occupancy, side by side, two 3 bedroom units each 7.8 m wide sharing a party wall. Unit 2 mirrors unit 1.
const DUAL_W = 7800;
function dualUnit(n, flip) {
  const mx = (x) => (flip ? 2 * DUAL_W - x : x);
  const side = (s) => (flip ? { e: 'w', w: 'e', n: 'n', s: 's' }[s] : s);
  const key = (k) => `u${n}_${k}`;
  const nm = (t) => `Unit ${n} ${t}`;
  const rect = (k, type, name, x0, y0, x1, y1, extra) => {
    const a = mx(x0);
    const c = mx(x1);
    return R(key(k), type, nm(name), Math.min(a, c), y0, Math.max(a, c), y1, extra);
  };
  const rooms = [
    rect('open', 'family', 'Kitchen, dining and living', 0, 0, 7800, 5600),
    rect('alf', 'alfresco', 'Alfresco', 1400, -3000, 6400, 0),
    rect('bed3', 'bedroom', 'Bed 3', 0, 5600, 3500, 8800),
    rect('bed2', 'bedroom', 'Bed 2', 0, 8800, 3500, 12000),
    rect('garage', 'garage', 'Garage', 0, 12000, 3500, 17600),
    rect('hall', 'hall', 'Hall', 3500, 5600, 4600, 16800),
    rect('bath', 'bathroom', 'Bathroom', 4600, 5600, 7800, 7800),
    rect('laundry', 'laundry', 'Laundry', 4600, 7800, 7800, 9400),
    rect('ens', 'ensuite', 'Ensuite', 4600, 9400, 7800, 11200),
    P(key('master'), 'bedroom', nm('Master'), [[4600, 11200], [7800, 11200], [7800, 16800], [6400, 16800], [6400, 15000], [4600, 15000]].map(([x, y]) => [mx(x), y])),
    rect('wir', 'robe', 'Walk-in robe', 4600, 15000, 6400, 16800),
    rect('porch', 'verandah', 'Porch', 3500, 16800, 6000, 18000),
  ];
  const at = (a) => (a);
  void at;
  const op = (preset, room, s, a, o = {}) => O(preset, key(room), side(s), s === 'n' || s === 's' ? mx(a) : a, { ...o, ...(o.into ? { into: key(o.into) } : {}) });
  const dr = (room, s, a, preset = 'door_internal', into = null) => op(preset, room, s, a, into ? { into } : {});
  const openings = [
    dr('hall', 's', 4050, 'door_entry', 'hall'), op('opening_900', 'hall', 'n', 4050),
    dr('bed3', 'e', 6400), dr('bed2', 'e', 11200), dr('bath', 'w', 6500), dr('laundry', 'w', 8600),
    dr('master', 'w', 12600), dr('ens', 's', 7000), dr('wir', 'e', 15900, 'door_cavity', 'wir'),
    dr('garage', 'e', 14500, 'door_internal', 'hall'),
    op('garage_door_2400', 'garage', 's', 1750), op('window_awning_1200', 'garage', 'w', 14500),
    op('sliding_door_3000', 'open', 'n', 3900), op('window_kitchen_1800', 'open', 'n', 1000),
    op('window_sliding_1800', 'open', 'w', 2800),
    op('window_sliding_1800', 'bed3', 'w', 7200), op('window_sliding_1800', 'bed2', 'w', 10400),
    op('window_sliding_1200', 'master', 's', 7100),
  ];
  return { rooms, openings };
}
const dualA = dualUnit(1, false);
const dualB = dualUnit(2, true);
const dualOcc = {
  id: 'dual_occupancy_narrow',
  type: 'unit',
  name: 'Dual occupancy, two 3 bedroom units side by side',
  description: 'Two mirror image 3 bedroom units, each 7.8 m wide, sharing a party wall with the wet rooms back to back. Each has a single garage, side hall, open plan living to an alfresco, master with walk-in robe and ensuite.',
  frontageM: 18,
  levels: [{ rooms: [...dualA.rooms, ...dualB.rooms], openings: [...dualA.openings, ...dualB.openings] }],
  roof: { type: 'hip', pitch: 22.5, overhang: 450 },
  tanks: [[-1100, 9000, 5000], [DUAL_W * 2 + 1500, 9000, 5000]],
  finishes: [['external_walls', 'brick', 'brick-light-grey'], ['roof', 'corrugated', 'steel-warm-grey']],
};

// ---------------------------------------------------------------------------------------------------------------------------
// 8. Acreage homestead, 4 bedroom, verandah all round and a double carport.
const homestead = {
  id: 'acreage_homestead_4bed',
  name: 'Acreage homestead, 4 bedroom',
  description: 'A wide single storey homestead for acreage or a broad lot. Verandah on all four sides, master suite at the rear, three bedrooms along the front, a separate lounge, open plan kitchen and family, and a double carport.',
  frontageM: 30,
  origin: [5000, 5000],
  levels: [{
    rooms: [
      R('master', 'bedroom', 'Master', 0, 0, 4800, 5400),
      R('ens', 'ensuite', 'Ensuite', 4800, 0, 7200, 2800),
      R('wir', 'robe', 'Walk-in robe', 4800, 2800, 7200, 5400),
      R('laundry', 'laundry', 'Laundry', 7200, 0, 9600, 3200),
      R('bath', 'bathroom', 'Bathroom', 7200, 3200, 9600, 5400),
      R('open', 'family', 'Kitchen, dining and family', 9600, 0, 18000, 5400),
      R('lounge', 'living', 'Lounge', 13000, 5400, 18000, 10800),
      R('hall', 'hall', 'Hall', 0, 5400, 13000, 6600),
      R('entry', 'entry', 'Entry', 10800, 6600, 13000, 10800),
      R('bed2', 'bedroom', 'Bed 2', 0, 6600, 3600, 10800),
      R('bed3', 'bedroom', 'Bed 3', 3600, 6600, 7200, 10800),
      R('bed4', 'bedroom', 'Bed 4', 7200, 6600, 10800, 10800),
      R('carport', 'carport', 'Double carport', 18000, 5400, 24000, 10800),
      R('vN', 'verandah', 'Verandah, rear', -2400, -2400, 18000, 0),
      R('vW', 'verandah', 'Verandah, west', -2400, 0, 0, 10800),
      R('vS', 'verandah', 'Verandah, front', -2400, 10800, 24000, 13200),
      R('vE', 'verandah', 'Verandah, east', 18000, -2400, 20400, 5400),
    ],
    openings: [
      D('master', 's', 2400), D('ens', 'w', 1400, 'door_cavity'), D('wir', 'w', 4000, 'door_cavity', 'wir'),
      D('bath', 's', 8400), D('laundry', 'e', 1600, 'door_internal', 'laundry'),
      O('opening_1800', 'hall', 'n', 11800), O('opening_900', 'lounge', 'w', 6000),
      O('opening_1800', 'lounge', 'n', 15500), O('opening_900', 'entry', 'n', 11900),
      O('opening_1800', 'entry', 'e', 8800, { width: 1400 }),
      D('entry', 's', 11900, 'door_entry', 'entry'),
      D('bed2', 'n', 1800), D('bed3', 'n', 5400), D('bed4', 'n', 9000),
      W('window_sliding_1800', 'master', 'n', 2400), W('window_sliding_1800', 'master', 'w', 2700),
      W('window_awning_600', 'ens', 'n', 6000),
      W('sliding_door_3000', 'open', 'n', 13800), W('window_kitchen_1800', 'open', 'n', 10800), W('window_sliding_1800', 'open', 'e', 2700),
      W('window_sliding_2400', 'lounge', 'e', 8000), O('sliding_door_2400', 'lounge', 's', 15500),
      W('window_sliding_1800', 'bed2', 's', 1800), W('window_sliding_1800', 'bed2', 'w', 8700),
      W('window_sliding_1800', 'bed3', 's', 5400), W('window_sliding_1800', 'bed4', 's', 9000),
    ],
  }],
  roof: { type: 'hip', pitch: 25, overhang: 600 },
  tanks: [[-3000, 5000, 22500]],
  finishes: [['external_walls', 'weatherboard', 'paint-cream'], ['roof', 'corrugated', 'steel-slate']],
};

// ---------------------------------------------------------------------------------------------------------------------------
// 9. Granny flat, 1 bedroom, about 49 m2.
const granny1 = {
  id: 'granny_1bed',
  type: 'unit',
  name: 'Granny flat, 1 bedroom',
  description: 'About 49 m². Open plan kitchen, living and dining with a front deck, a double bedroom with robe, and a bathroom that includes the laundry.',
  frontageM: null,
  levels: [{
    rooms: [
      R('bed', 'bedroom', 'Bedroom', 0, 0, 3600, 3400),
      R('bath', 'bathroom', 'Bathroom and laundry', 0, 3400, 3600, 5400),
      R('open', 'family', 'Kitchen, living and dining', 3600, 0, 9000, 5400),
      R('deck', 'deck', 'Deck', 3600, 5400, 9000, 7600, { balustrade: true }),
    ],
    openings: [
      D('bed', 'e', 1700), D('bath', 'e', 4400),
      D('open', 's', 8200, 'door_entry', 'open'), O('sliding_door_2100', 'open', 's', 5200),
      W('window_kitchen_1800', 'open', 'n', 5000), W('window_sliding_1800', 'open', 'e', 2700),
      W('window_sliding_1800', 'bed', 'w', 1700), W('window_sliding_1200', 'bed', 'n', 1800),
      W('window_awning_1200', 'bath', 'w', 4400),
    ],
  }],
  roof: { type: 'gable', pitch: 15, overhang: 450 },
  tanks: [[10800, 2000, 2000]],
  finishes: [['external_walls', 'weatherboard', 'paint-sage'], ['roof', 'corrugated', 'steel-off-white']],
};

// ---------------------------------------------------------------------------------------------------------------------------
// 10. Studio granny flat, about 37 m2.
const studio = {
  id: 'granny_studio',
  type: 'unit',
  name: 'Granny flat, studio',
  description: 'About 37 m². One open studio for living, kitchen and sleeping, a bathroom, a laundry cupboard and a front deck. For a backyard, a home office conversion or a guest suite.',
  frontageM: null,
  furn: { 'Studio: living, kitchen and sleeping': { studio: true } },
  levels: [{
    rooms: [
      R('bath', 'bathroom', 'Bathroom', 0, 0, 2600, 3000),
      R('laundry', 'laundry', 'Laundry', 0, 3000, 2600, 5000),
      R('studio', 'family', 'Studio: living, kitchen and sleeping', 2600, 0, 7400, 5000),
      R('deck', 'deck', 'Deck', 2600, 5000, 7400, 6600, { balustrade: true }),
    ],
    openings: [
      D('bath', 'e', 1500), D('laundry', 'e', 4000),
      D('studio', 's', 6600, 'door_entry', 'studio'), O('sliding_door_2100', 'studio', 's', 4000),
      W('window_kitchen_1800', 'studio', 'n', 4800), W('window_sliding_1800', 'studio', 'e', 2500),
      W('window_awning_1200', 'bath', 'w', 1500), W('window_awning_1200', 'laundry', 'w', 4000),
    ],
  }],
  roof: { type: 'skillion', pitch: 8, overhang: 450 },
  tanks: [[9000, 1500, 2000]],
  finishes: [['external_walls', 'vertical_cladding', 'paint-charcoal'], ['roof', 'standing_seam', 'steel-black']],
};

// ---------------------------------------------------------------------------------------------------------------------------
// 11. Granny flat, 2 bedroom with carport, about 53 m2.
const granny2 = {
  id: 'granny_2bed_carport',
  type: 'unit',
  name: 'Granny flat, 2 bedroom with carport',
  description: 'About 53 m² plus a single carport. Bedrooms at each end with a bathroom and laundry between them, open plan kitchen, living and dining across the front, and a covered porch.',
  frontageM: null,
  levels: [{
    rooms: [
      R('bed1', 'bedroom', 'Bed 1', 0, 0, 3300, 3200),
      R('bath', 'bathroom', 'Bathroom and laundry', 3300, 0, 5300, 3200),
      R('bed2', 'bedroom', 'Bed 2', 5300, 0, 8600, 3200),
      R('open', 'family', 'Kitchen, living and dining', 0, 3200, 8600, 6200),
      R('carport', 'carport', 'Carport', 8600, 0, 11600, 6200),
      R('porch', 'verandah', 'Porch', 600, 6200, 3600, 7400),
      R('deck', 'deck', 'Deck', 4600, 6200, 8600, 8000, { balustrade: true }),
    ],
    openings: [
      D('bed1', 's', 1650), D('bath', 's', 4300), D('bed2', 's', 6950),
      D('open', 's', 2100, 'door_entry', 'open'), O('sliding_door_2100', 'open', 's', 6200),
      W('window_sliding_1800', 'bed1', 'n', 1650), W('window_sliding_1200', 'bed1', 'w', 1600),
      W('window_awning_1200', 'bath', 'n', 4300),
      W('window_sliding_1800', 'bed2', 'n', 6950), W('window_sliding_1200', 'bed2', 'e', 1600),
      W('window_sliding_1200', 'open', 'w', 4700), W('window_sliding_1800', 'open', 'e', 4700),
    ],
  }],
  roof: { type: 'gable', pitch: 15, overhang: 450 },
  tanks: [[-1200, 1500, 2000]],
  finishes: [['external_walls', 'weatherboard', 'paint-light-grey'], ['roof', 'corrugated', 'steel-gum-green']],
};

// ---------------------------------------------------------------------------------------------------------------------------
// 12. Shed house, barn style: open plan living in a portal frame shed, mezzanine bedroom and loft, workshop bay.
const shedHouse = {
  id: 'shed_house_barn',
  name: 'Shed house, barn style, 2 bedroom',
  description: 'A 16.8 x 9 m portal frame shed with 5.1 m walls. Double height open plan living, a ground floor bedroom, bathroom and laundry, a mezzanine bedroom and study loft reached by a straight stair, a 4.8 m workshop bay with a roller door, and a front verandah. Whether a shed can be lived in is a council and building code matter.',
  frontageM: 20,
  origin: [3000, 3000],
  levels: [
    {
      name: 'Ground',
      height: 5100,
      rooms: [
        R('open', 'family', 'Kitchen, dining and living', 0, 0, 8400, 9000),
        R('bed1', 'bedroom', 'Bed 1', 8400, 0, 12000, 3800),
        R('bath', 'bathroom', 'Bathroom', 8400, 3800, 12000, 6000),
        R('entry', 'entry', 'Entry', 8400, 6000, 10200, 9000),
        R('laundry', 'laundry', 'Laundry', 10200, 6000, 12000, 9000),
        R('garage', 'garage', 'Garage and workshop', 12000, 0, 16800, 9000),
        R('verandah', 'verandah', 'Verandah', 0, 9000, 12000, 11400),
      ],
      openings: [
        D('bed1', 'w', 1900), D('bath', 'w', 4900),
        O('opening_1800', 'entry', 'w', 7500, { width: 1400 }), D('entry', 's', 9300, 'door_entry', 'entry'),
        D('laundry', 'w', 7500, 'door_internal', 'laundry'), D('laundry', 'e', 7500, 'door_internal', 'laundry'),
        O('roller_door_3600', 'garage', 's', 14400),
        O('sliding_door_3000', 'open', 's', 3000), W('window_sliding_2400', 'open', 's', 6600),
        W('window_sliding_1800', 'open', 'w', 4500),
        W('window_sliding_1800', 'open', 'n', 2400, { sill: 2900, height: 2000 }), W('window_sliding_1800', 'open', 'n', 6000, { sill: 2900, height: 2000 }),
        W('window_kitchen_1800', 'open', 'n', 4200),
        W('window_sliding_1800', 'bed1', 'n', 10200),
        W('window_sliding_1800', 'garage', 'n', 14400),
      ],
      stairs: [[6200, 6000, 1000, 3600, 180]],
      keepClear: [[5500, 4200, 6900, 7800]],
    },
    {
      name: 'Mezzanine',
      elevation: 2700,
      height: 2300,
      roof: { enabled: false },
      rooms: [
        R('mbed', 'bedroom', 'Bed 2', 400, 400, 4400, 4200),
        R('loft', 'study', 'Study loft', 4400, 400, 8000, 4200),
      ],
      openings: [
        D('mbed', 'e', 2200), O('opening_1800', 'loft', 's', 6200, { width: 1800 }),
        W('window_sliding_1800', 'mbed', 'n', 2400, { sill: 900 }), W('window_sliding_1800', 'loft', 'n', 6000, { sill: 900 }),
      ],
    },
  ],
  roof: { type: 'gable', pitch: 15, overhang: 300 },
  finishes: [['external_walls', 'corrugated', 'steel-ironbark'], ['roof', 'corrugated', 'steel-slate']],
};

export const SPECS = [narrow10, narrow125, narrow14, starter, narrowDouble, townhouse, dualOcc, homestead, granny1, studio, granny2, shedHouse];
