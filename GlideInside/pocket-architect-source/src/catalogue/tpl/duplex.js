// Duplex: two mirror image attached 3 bedroom units sharing a party wall. Each unit is 8.5 m wide
// and 17 m deep with a single garage at the front (south), open living at the rear (north) opening
// to a courtyard patio, bedrooms and wet rooms either side of a long hall.

import { plan } from './kit.js';

const OX = 2000;
const OY = 3600;
const W = 8500; // width of one unit; the party wall sits at x = W
const SWAP = { e: 'w', w: 'e', n: 'n', s: 's' };

function buildUnit(b, mirror) {
  const mx = (x) => OX + (mirror ? 2 * W - x : x);
  const Y = (y) => OY + y;
  const side = (s) => (mirror ? SWAP[s] : s);
  const along = (s, v) => (s === 'n' || s === 's' ? mx(v) : Y(v)); // plan coordinate along a side
  const R = (type, name, x0, y0, x1, y1, extra) => {
    const a = mx(x0);
    const c = mx(x1);
    return b.room(type, name, Math.min(a, c), Y(y0), Math.abs(c - a), y1 - y0, extra);
  };
  const open = (preset, room, s, at, o = {}) => b.opening(preset, room, side(s), at === 'c' ? 'c' : along(s, at), { abs: at !== 'c', ...o });
  const door = (room, s, at, o = {}) => open(o.preset || 'door_internal', room, s, at, o);
  const rotOf = (r) => (mirror ? (360 - (r % 360)) % 360 : r);
  const against = (item, room, s, o = {}) => {
    const oo = { ...o };
    if (oo.at !== undefined && oo.at !== 'start' && oo.at !== 'end' && oo.at !== 'c') oo.at = along(s, oo.at);
    else if (mirror && (s === 'n' || s === 's') && oo.at === 'start') oo.at = 'end';
    else if (mirror && (s === 'n' || s === 's') && oo.at === 'end') oo.at = 'start';
    if (typeof oo.at === 'number') oo.abs = true;
    return b.against(item, room, side(s), oo);
  };
  const place = (item, x, y, rot = 0, o) => b.place(item, mx(x), Y(y), rotOf(rot), o);

  // Rooms.
  const living = R('living', 'Living, kitchen and dining', 0, 0, W, 5200);
  const bed2 = R('bedroom', 'Bed 2', 0, 5200, 3600, 8200);
  const bed3 = R('bedroom', 'Bed 3', 0, 8200, 3600, 11200);
  const garage = R('garage', 'Garage', 0, 11200, 3600, 17000);
  const hall = R('hall', 'Hall', 3600, 5200, 4800, 17000);
  const bath = R('bathroom', 'Bathroom', 4800, 5200, W, 7600);
  const laundry = R('laundry', 'Laundry', 4800, 7600, W, 9600);
  const ensuite = R('ensuite', 'Ensuite', 4800, 9600, W, 11400);
  const master = R('bedroom', 'Master', 4800, 11400, W, 17000);
  const patio = R('patio', 'Courtyard', 1000, -3400, 7500, 0);

  // Party wall is a 250 mm wall.
  const pw = mx(W);
  for (const w of b.lvl.walls) if (Math.abs(w.a.x - pw) < 2 && Math.abs(w.b.x - pw) < 2 && w.thickness !== 250) b.run('update_wall', { id: w.id, thickness: 250 });

  // Doors.
  open('opening_900', living, 's', 4200);
  door(bed2, 'e', 6500);
  door(bed3, 'e', 9500);
  door(bath, 'w', 6400);
  door(laundry, 'w', 9050);
  door(master, 'w', 13600);
  door(master, 'n', 5600, { into: ensuite });
  door(garage, 'e', 14000, { into: garage });
  open('door_entry', hall, 's', 4200, { into: hall });
  open('garage_door_2400', garage, 's', 1800);

  // Windows.
  open('sliding_door_3000', living, 'n', 6500);
  open('window_kitchen_1800', living, 'n', 1800);
  open('window_sliding_1800', living, 'w', 3000);
  open('window_sliding_1800', bed2, 'w', 6700);
  open('window_sliding_1800', bed3, 'w', 9700);
  open('window_sliding_1800', master, 's', 6200);

  // Living, kitchen and dining.
  against('kitchen_bench', living, 'n', { at: 1800 });
  against('fridge', living, 'n', { at: 3900 });
  place('kitchen_island', 2200, 2400, 0);
  place('dining_4', 3100, 3800, 0);
  against('tv_unit', living, 's', { at: 6600, w: 1800 });
  place('rug', 6600, 3200, 0, { w: 2400, d: 1600 });
  place('sofa_3', 6600, 2300, 0);
  place('coffee_table', 6600, 3500, 0);
  against('plant', living, 'e', { at: 4800 });

  // Bedrooms.
  against('bed_double', bed2, 'w', { at: 6700 });
  against('wardrobe', bed2, 's', { at: 2400 });
  against('bed_double', bed3, 'w', { at: 9700 });
  against('wardrobe', bed3, 's', { at: 2400 });
  against('bed_king', master, 'e', { at: 14200 });
  against('bedside', master, 'e', { at: 12950 });
  against('bedside', master, 'e', { at: 15450 });
  against('wardrobe', master, 'w', { at: 15300 });

  // Wet rooms.
  against('bath', bath, 'e', { at: 6450 });
  against('shower_900', bath, 'n', { at: 6500 });
  against('vanity_single', bath, 's', { at: 5800 });
  against('toilet', bath, 's', { at: 7000 });
  against('laundry_tub', laundry, 'n', { at: 5400 });
  against('washer', laundry, 'n', { at: 6200 });
  against('dryer', laundry, 'n', { at: 6800 });
  against('vanity_double', ensuite, 'n', { at: 5800 });
  against('toilet', ensuite, 'n', { at: 7000 });
  against('shower_1200', ensuite, 'e', { at: 10700 });

  // Garage and courtyard.
  place('car_sedan', 1800, 14100, 0);
  place('outdoor_table', 4300, -1900, 0);
  against('bbq', patio, 'n', { at: 1800 });
  b.tank(mirror ? mx(0) + 1050 : mx(0) - 1050, Y(14500), 2000);
}

export function duplex() {
  const b = plan({ name: 'Duplex, two 3 bedroom units', type: 'unit' });
  buildUnit(b, false);
  buildUnit(b, true);
  return b.done();
}
