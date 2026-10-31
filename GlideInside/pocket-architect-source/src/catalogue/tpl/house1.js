// Single storey four bedroom house, about 200 m2 plus a double garage forward (south) so the
// hip roof forms a valley where the garage meets the main block. Living faces the roofed alfresco
// at the rear (north). Local coordinates (lx, ly) are offset by (OX, OY) so everything is positive.

import { plan } from './kit.js';

const OX = 2400;
const OY = 4400;
const X = (x) => x + OX;
const Y = (y) => y + OY;

export function houseSingle() {
  const b = plan({ name: 'Single storey, 4 bedroom', type: 'house' });
  const R = (type, name, x0, y0, x1, y1, extra) => b.room(type, name, X(x0), Y(y0), x1 - x0, y1 - y0, extra);

  // Rear row: master suite and the open plan living area.
  const master = R('bedroom', 'Master', 0, 0, 4800, 5200);
  const ensuite = R('ensuite', 'Ensuite', 4800, 0, 7200, 2800);
  const wir = R('robe', 'Walk-in robe', 4800, 2800, 7200, 5200);
  const open = R('family', 'Kitchen, dining and family', 7200, 0, 17000, 5200);

  // Hall (L shaped corridor with a lobby), then the rooms around it.
  const pts = [[3400, 5200], [13600, 5200], [13600, 11800], [12600, 11800], [12600, 6400], [8600, 6400], [8600, 9400], [6200, 9400], [6200, 6400], [3400, 6400]];
  const { id: hallId } = b.run('add_room_polygon', { type: 'hall', name: 'Hall', points: pts.map(([x, y]) => ({ x: X(x), y: Y(y) })) });
  const hall = b.lvl.rooms.find((r) => r.id === hallId);
  const bed4 = R('bedroom', 'Bed 4', 0, 5200, 3400, 9200);
  const laundry = R('laundry', 'Laundry', 0, 9200, 3400, 11800);
  const bath = R('bathroom', 'Bathroom', 3400, 6400, 6200, 9400);
  const wc = R('wc', 'WC', 3400, 9400, 6200, 10600);
  const mud = R('store', 'Mud room', 3400, 10600, 6200, 11800);
  const entry = R('entry', 'Entry', 6200, 9400, 8600, 11800);
  const lounge = R('living', 'Lounge', 8600, 6400, 12600, 11800);
  const bed2 = R('bedroom', 'Bed 2', 13600, 5200, 17000, 8500);
  const bed3 = R('bedroom', 'Bed 3', 13600, 8500, 17000, 11800);

  // Double garage forward of the main block, and the roofed alfresco at the rear.
  const garage = R('garage', 'Garage', 0, 11800, 6200, 17800);
  const alfresco = R('alfresco', 'Alfresco', 7600, -4000, 16600, 0);

  // Doors.
  b.door(master, 's', X(4100), { abs: true });
  b.door(master, 'e', Y(1400), { abs: true, preset: 'door_cavity', into: ensuite });
  b.door(master, 'e', Y(3500), { abs: true, preset: 'door_cavity', into: wir });
  b.door(bed4, 'e', Y(5800), { abs: true });
  b.door(bath, 'n', X(4800), { abs: true });
  b.door(wc, 'e', Y(10000), { abs: true });
  b.door(laundry, 'e', Y(11200), { abs: true, preset: 'door_cavity', into: mud });
  b.door(mud, 's', X(5500), { abs: true });
  b.door(mud, 'e', Y(11200), { abs: true, preset: 'door_cavity', into: entry });
  b.door(lounge, 'w', Y(10600), { abs: true, preset: 'door_cavity', into: lounge });
  b.door(bed2, 'w', Y(5800), { abs: true });
  b.door(bed3, 'w', Y(10900), { abs: true });
  b.opening('door_entry', entry, 's', X(7400), { abs: true, into: entry });
  b.opening('opening_1800', entry, 'n', X(7400), { abs: true, width: 1500 });
  b.opening('opening_1800', open, 's', X(9000), { abs: true });
  b.opening('garage_door_4800', garage, 's', X(3100), { abs: true });

  // Windows and sliding doors.
  b.opening('window_sliding_1800', master, 'n', X(2400), { abs: true });
  b.opening('window_sliding_1800', master, 'w', Y(3500), { abs: true });
  b.opening('window_awning_600', ensuite, 'n', X(5400), { abs: true });
  b.opening('window_kitchen_1800', open, 'n', X(8750), { abs: true });
  b.opening('sliding_door_3000', open, 'n', X(13200), { abs: true });
  b.opening('window_sliding_1800', open, 'n', X(15900), { abs: true });
  b.opening('window_sliding_1800', bed4, 'w', Y(7200), { abs: true });
  b.opening('window_awning_1200', laundry, 'w', Y(10500), { abs: true });
  b.opening('window_sliding_2400', lounge, 's', X(10600), { abs: true });
  b.opening('window_sliding_1800', bed2, 'e', Y(6850), { abs: true });
  b.opening('window_sliding_1800', bed3, 'e', Y(10150), { abs: true });
  b.opening('window_awning_1200', garage, 'w', Y(14800), { abs: true });

  // Master suite.
  b.against('bed_king', master, 'n', { at: X(2400), abs: true });
  b.against('bedside', master, 'n', { at: X(1210), abs: true });
  b.against('bedside', master, 'n', { at: X(3590), abs: true });
  b.against('chest_drawers', master, 'w', { at: Y(1500), abs: true });
  b.place('armchair', X(900), Y(4300), 90);
  b.against('shower_1200', ensuite, 'n', { at: 'end' });
  b.against('vanity_single', ensuite, 's', { at: X(5400), abs: true });
  b.against('toilet', ensuite, 's', { at: X(6700), abs: true });
  b.against('wardrobe', wir, 'e', { at: Y(4000), abs: true });
  b.against('wardrobe', wir, 's', { at: X(5700), abs: true, w: 1200 });

  // Bedrooms 4, 2 and 3.
  b.against('bed_double', bed4, 'w', { at: Y(7200), abs: true });
  b.against('wardrobe', bed4, 's', { at: X(1900), abs: true });
  b.against('bed_double', bed2, 'e', { at: Y(6850), abs: true });
  b.against('wardrobe', bed2, 's', { at: X(15200), abs: true });
  b.against('bed_double', bed3, 'e', { at: Y(10150), abs: true });
  b.against('wardrobe', bed3, 'n', { at: X(15200), abs: true });

  // Wet rooms and laundry.
  b.against('bath', bath, 'w', { at: Y(7500), abs: true });
  b.against('shower_900', bath, 's', { at: 'start' });
  b.against('toilet', bath, 's', { at: X(5400), abs: true });
  b.against('vanity_single', bath, 'e', { at: Y(7400), abs: true });
  b.against('toilet', wc, 'w', { at: Y(10000), abs: true });
  b.against('laundry_tub', laundry, 'n', { at: X(625), abs: true });
  b.against('washer', laundry, 'n', { at: X(1425), abs: true });
  b.against('dryer', laundry, 'n', { at: X(2025), abs: true });

  // Open plan: kitchen, dining and family.
  b.against('kitchen_bench', open, 'n', { at: X(8750), abs: true });
  b.against('fridge', open, 'n', { at: X(10800), abs: true });
  b.against('pantry_unit', open, 'w', { at: Y(4300), abs: true });
  b.place('kitchen_island', X(9000), Y(2500), 0);
  b.place('dining_6', X(12300), Y(2700), 0);
  b.place('rug', X(15200), Y(3300), 0, { w: 2400, d: 1600 });
  b.against('sofa_l', open, 'n', { at: X(15200), abs: true, gap: 800, rot: 0 });
  b.place('coffee_table', X(15200), Y(3500), 0);
  b.against('tv_unit', open, 's', { at: X(15200), abs: true });

  // Lounge.
  b.against('tv_unit', lounge, 'n', { at: X(10600), abs: true });
  b.place('rug', X(10600), Y(8500), 0, { w: 2400, d: 1600 });
  b.place('coffee_table', X(10600), Y(8500), 0);
  b.place('sofa_3', X(10600), Y(9900), 180);
  b.place('armchair', X(9300), Y(8500), 270);
  b.place('armchair', X(11700), Y(8500), 90);
  b.against('bookshelf', lounge, 'e', { at: Y(9000), abs: true });

  // Garage: two cars, shelving on the west wall.
  b.place('car_sedan', X(1600), Y(14800), 0);
  b.place('car_ute', X(4200), Y(14800), 0);
  b.against('shelving', garage, 'w', { at: Y(16500), abs: true });

  // Alfresco.
  b.place('outdoor_table', X(12500), Y(-2000), 0);
  b.against('bbq', alfresco, 'n', { at: X(15500), abs: true });

  b.tank(1150, Y(14800), 5000);
  void hall;
  return b.done();
}
