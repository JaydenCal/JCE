// Double storey four bedroom house. The ground floor is 14 x 12 m with the garage at the front
// (south). The first floor is smaller (it stops 3.4 m short of the west side), so the lower hip
// roof shows along the west wing. Local coordinates (lx, ly) are offset to stay positive.

import { plan } from './kit.js';

const OX = 2400;
const OY = 4000;
const X = (x) => x + OX;
const Y = (y) => y + OY;

export function houseDouble() {
  const b = plan({ name: 'Double storey, 4 bedroom', type: 'house' });
  const ground = b.project.levels[0].id;
  const R = (type, name, x0, y0, x1, y1, extra) => b.room(type, name, X(x0), Y(y0), x1 - x0, y1 - y0, extra);
  const poly = (type, name, pts) => {
    const { id } = b.run('add_room_polygon', { type, name, points: pts.map(([x, y]) => ({ x: X(x), y: Y(y) })) });
    return b.lvl.rooms.find((r) => r.id === id);
  };

  // ---------------------------------------------------------------- ground floor
  b.use(ground);
  const guest = R('bedroom', 'Guest bedroom', 0, 0, 3400, 3800);
  const laundry = R('laundry', 'Laundry', 0, 3800, 3400, 5600);
  const open = R('family', 'Kitchen, dining and family', 3400, 0, 14000, 5600);
  const garage = R('garage', 'Garage', 0, 5600, 6200, 12000);
  const hall = R('hall', 'Hall', 6200, 5600, 8400, 9400);
  const entry = R('entry', 'Entry', 6200, 9400, 8400, 12000);
  const powder = R('wc', 'Powder room', 8400, 5600, 10200, 7600);
  const study = R('study', 'Study', 10200, 5600, 14000, 7600);
  const living = R('living', 'Living', 8400, 7600, 14000, 12000);
  const alfresco = R('alfresco', 'Alfresco', 5000, -3600, 13000, 0);

  // Doors.
  b.opening('door_entry', entry, 's', X(7300), { abs: true, into: entry });
  b.opening('opening_1800', entry, 'n', X(7300), { abs: true, width: 1400 });
  b.opening('door_internal', garage, 'e', Y(11000), { abs: true, into: entry });
  b.opening('door_internal', laundry, 's', X(1700), { abs: true, into: garage });
  b.opening('door_internal', laundry, 'e', Y(4700), { abs: true, into: laundry });
  b.opening('door_internal', guest, 'e', Y(1500), { abs: true, into: guest });
  b.opening('opening_1800', open, 's', X(7300), { abs: true });
  b.opening('door_internal', powder, 'w', Y(6600), { abs: true, into: powder });
  b.opening('door_internal', study, 's', X(13000), { abs: true, into: study });
  b.opening('opening_900', living, 'w', Y(8500), { abs: true, width: 1200 });
  b.opening('garage_door_4800', garage, 's', X(3100), { abs: true });

  // Windows.
  b.opening('window_kitchen_1800', open, 'n', X(5500), { abs: true });
  b.opening('sliding_door_3000', open, 'n', X(10800), { abs: true });
  b.opening('window_sliding_1200', open, 'n', X(13100), { abs: true });
  b.opening('window_sliding_1800', guest, 'w', Y(1900), { abs: true });
  b.opening('window_awning_1200', laundry, 'w', Y(4700), { abs: true });
  b.opening('window_sliding_1200', study, 'e', Y(6600), { abs: true });
  b.opening('window_sliding_2400', living, 's', X(10500), { abs: true });
  b.opening('window_sliding_1800', living, 'e', Y(10000), { abs: true });

  // Furniture.
  b.against('bed_queen', guest, 'w', { at: Y(1900), abs: true });
  b.against('wardrobe', guest, 's', { at: X(2300), abs: true });
  b.against('laundry_tub', laundry, 'n', { at: X(625), abs: true });
  b.against('washer', laundry, 'n', { at: X(1425), abs: true });
  b.against('dryer', laundry, 'n', { at: X(2025), abs: true });
  b.against('kitchen_bench', open, 'n', { at: X(5500), abs: true });
  b.against('fridge', open, 'n', { at: X(7500), abs: true });
  b.against('pantry_unit', open, 'w', { at: Y(1200), abs: true });
  b.place('kitchen_island', X(5600), Y(2400), 0);
  b.place('dining_8', X(9000), Y(2600), 0);
  b.place('rug', X(12400), Y(3200), 0, { w: 2400, d: 1600 });
  b.place('sofa_l', X(12400), Y(2300), 0);
  b.place('coffee_table', X(12400), Y(3700), 0);
  b.against('tv_unit', open, 's', { at: X(12400), abs: true });
  b.against('toilet', powder, 'n', { at: X(9600), abs: true });
  b.against('vanity_single', powder, 's', { at: X(9600), abs: true });
  b.against('desk', study, 'n', { at: X(11500), abs: true });
  b.place('office_chair', X(11500), Y(6850), 180);
  b.against('bookshelf', study, 'w', { at: Y(6600), abs: true });
  b.against('tv_unit', living, 'n', { at: X(10500), abs: true });
  b.place('rug', X(10500), Y(9000), 0, { w: 2400, d: 1600 });
  b.place('coffee_table', X(10500), Y(9000), 0);
  b.place('sofa_3', X(10500), Y(10500), 180);
  b.place('armchair', X(12050), Y(9000), 90);
  b.place('car_sedan', X(1700), Y(9000), 0);
  b.place('car_ute', X(4500), Y(8800), 0);

  // Stairs rise to the north from the entry end of the hall.
  b.stair(X(6850), Y(7550), 1000, 3600, 180, ground);

  // Alfresco.
  b.place('outdoor_table', X(8500), Y(-1900), 0);
  b.against('bbq', alfresco, 'n', { at: X(11800), abs: true });

  // ---------------------------------------------------------------- first floor
  const { id: l1 } = b.run('add_level', { name: 'First', copy_outline: false });
  b.use(l1);
  const bed2 = R('bedroom', 'Bed 2', 3400, 0, 6800, 5600);
  const ensuite = R('ensuite', 'Ensuite', 6800, 0, 8400, 2800);
  const robe = R('robe', 'Robe', 6800, 2800, 8400, 5600);
  const master = R('bedroom', 'Master', 8400, 0, 14000, 5600);
  const bath = R('bathroom', 'Bathroom', 3400, 6800, 6200, 9000);
  const bed3 = R('bedroom', 'Bed 3', 3400, 9000, 6200, 12000);
  const bed4 = R('bedroom', 'Bed 4', 8400, 6800, 11200, 12000);
  const rumpus = R('rumpus', 'Rumpus', 11200, 5600, 14000, 12000);
  const landing = poly('hall', 'Landing and stair void', [[3400, 5600], [11200, 5600], [11200, 6800], [8400, 6800], [8400, 12000], [6200, 12000], [6200, 6800], [3400, 6800]]);

  // Doors.
  b.door(bed2, 's', X(6200), { abs: true });
  b.door(bath, 'e', Y(7600), { abs: true });
  b.door(bed3, 'e', Y(11000), { abs: true });
  b.door(bed4, 'w', Y(7600), { abs: true });
  b.door(master, 's', X(10000), { abs: true });
  b.door(master, 'w', Y(1400), { abs: true, preset: 'door_cavity', into: ensuite });
  b.door(master, 'w', Y(3600), { abs: true, preset: 'door_cavity', into: robe });
  b.door(rumpus, 'w', Y(6200), { abs: true });

  // Windows.
  b.opening('window_sliding_1800', master, 'n', X(11200), { abs: true });
  b.opening('window_sliding_1800', master, 'e', Y(3000), { abs: true });
  b.opening('window_awning_600', ensuite, 'n', X(7300), { abs: true });
  b.opening('window_sliding_1800', bed2, 'n', X(5100), { abs: true });
  b.opening('window_sliding_1800', bed2, 'w', Y(1800), { abs: true });
  b.opening('window_awning_600', bath, 'w', Y(7500), { abs: true });
  b.opening('window_sliding_1200', bed3, 's', X(4800), { abs: true });
  b.opening('window_sliding_1200', bed3, 'w', Y(10600), { abs: true });
  b.opening('window_sliding_1800', bed4, 's', X(9800), { abs: true });
  b.opening('window_sliding_1800', rumpus, 's', X(12600), { abs: true });
  b.opening('window_sliding_1800', rumpus, 'e', Y(7200), { abs: true });
  b.opening('window_sliding_1200', landing, 's', X(7300), { abs: true });

  // Furniture.
  b.against('bed_king', master, 'n', { at: X(11200), abs: true });
  b.against('bedside', master, 'n', { at: X(10000), abs: true });
  b.against('bedside', master, 'n', { at: X(12400), abs: true });
  b.against('chest_drawers', master, 'e', { at: Y(4400), abs: true });
  b.place('armchair', X(9300), Y(4600), 90);
  b.against('shower_900', ensuite, 's', { at: 'start' });
  b.against('vanity_single', ensuite, 'n', { at: X(7950), abs: true });
  b.against('toilet', ensuite, 'w', { at: Y(1000), abs: true });
  b.against('wardrobe', robe, 'w', { at: Y(3900), abs: true });
  b.against('wardrobe', robe, 's', { at: X(7700), abs: true, w: 1200 });
  b.against('bed_queen', bed2, 'n', { at: X(5100), abs: true });
  b.against('bedside', bed2, 'n', { at: X(3950), abs: true });
  b.against('wardrobe', bed2, 'w', { at: Y(4300), abs: true });
  b.against('bath', bath, 'n', { at: X(4400), abs: true });
  b.against('shower_900', bath, 's', { at: 'start' });
  b.against('vanity_single', bath, 's', { at: X(4800), abs: true });
  b.against('toilet', bath, 's', { at: X(5400), abs: true });
  b.against('bed_double', bed3, 'w', { at: Y(10600), abs: true });
  b.against('wardrobe', bed3, 'n', { at: X(5300), abs: true, w: 1200 });
  b.against('bed_double', bed4, 'e', { at: Y(9500), abs: true });
  b.against('wardrobe', bed4, 'w', { at: Y(10500), abs: true });
  b.against('tv_unit', rumpus, 'w', { at: Y(9500), abs: true, w: 1500 });
  b.against('sofa_3', rumpus, 'e', { at: Y(9500), abs: true });
  b.place('coffee_table', X(12450), Y(9500), 90);

  b.tank(1250, Y(9000), 5000);
  void ground;
  return b.done();
}
