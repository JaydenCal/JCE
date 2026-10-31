// Extension starter: an existing 3 bedroom brick house (marked existing), a new rear family room
// and deck (new), and one section of the existing rear wall marked for demolition where the house
// opens into the new room. Local coordinates are offset to stay positive. North is the rear.

import { plan } from './kit.js';

const OX = 1000;
const OY = 8600;
const X = (x) => x + OX;
const Y = (y) => y + OY;

export function extensionStarter() {
  const b = plan({ name: 'Extension: rear family room', type: 'extension' });
  const R = (type, name, x0, y0, x1, y1, extra) => b.room(type, name, X(x0), Y(y0), x1 - x0, y1 - y0, extra);

  // ---------------------------------------------------------------- existing house, 13 x 9.6 m
  const kitchen = R('kitchen', 'Kitchen and dining', 0, 0, 5400, 4800);
  const bed2 = R('bedroom', 'Bed 2', 5400, 0, 9200, 4800);
  const bed3 = R('bedroom', 'Bed 3', 9200, 0, 13000, 4800);
  const master = R('bedroom', 'Master', 0, 4800, 3800, 9600);
  const { id: hallId } = b.run('add_room_polygon', {
    type: 'hall',
    name: 'Hall',
    points: [[3800, 4800], [13000, 4800], [13000, 6000], [5000, 6000], [5000, 9600], [3800, 9600]].map(([x, y]) => ({ x: X(x), y: Y(y) })),
  });
  const hall = b.lvl.rooms.find((r) => r.id === hallId);
  const bath = R('bathroom', 'Bathroom', 5000, 6000, 7400, 9600);
  const laundry = R('laundry', 'Laundry', 7400, 6000, 9400, 9600);
  const living = R('living', 'Living', 9400, 6000, 13000, 9600);

  // Doors.
  b.opening('door_entry', master, 's', X(4400), { abs: true });
  b.opening('opening_900', kitchen, 's', X(4600), { abs: true, width: 900 });
  b.door(bed2, 's', X(6800), { abs: true });
  b.door(bed3, 's', X(11000), { abs: true });
  b.door(master, 'e', Y(8000), { abs: true });
  b.door(bath, 'w', Y(8300), { abs: true });
  b.door(laundry, 'n', X(8400), { abs: true, into: laundry });
  b.door(living, 'n', X(11200), { abs: true });

  // Windows.
  b.opening('window_sliding_1800', kitchen, 'w', Y(2400), { abs: true });
  b.opening('window_sliding_1800', bed2, 'n', X(7300), { abs: true });
  b.opening('window_sliding_1800', bed3, 'n', X(11100), { abs: true });
  b.opening('window_sliding_1800', bed3, 'e', Y(2400), { abs: true });
  b.opening('window_sliding_1800', master, 'w', Y(6300), { abs: true });
  b.opening('window_sliding_1800', master, 's', X(1900), { abs: true });
  b.opening('window_awning_1200', bath, 's', X(6200), { abs: true });
  b.opening('window_awning_1200', laundry, 's', X(8400), { abs: true });
  b.opening('window_sliding_2400', living, 's', X(11200), { abs: true });
  b.opening('window_sliding_1800', living, 'e', Y(7800), { abs: true });

  // Furniture.
  b.against('kitchen_bench', kitchen, 'w', { at: Y(2000), abs: true });
  b.against('fridge', kitchen, 'w', { at: Y(4000), abs: true });
  b.place('dining_6', X(3300), Y(2300), 0);
  b.against('bed_queen', bed2, 'n', { at: X(7300), abs: true });
  b.against('bedside', bed2, 'n', { at: X(6200), abs: true });
  b.against('bedside', bed2, 'n', { at: X(8400), abs: true });
  b.against('wardrobe', bed2, 'e', { at: Y(3300), abs: true });
  b.against('bed_queen', bed3, 'n', { at: X(11100), abs: true });
  b.against('bedside', bed3, 'n', { at: X(10000), abs: true });
  b.against('bedside', bed3, 'n', { at: X(12200), abs: true });
  b.against('wardrobe', bed3, 'w', { at: Y(3300), abs: true });
  b.against('bed_king', master, 'n', { at: X(1900), abs: true });
  b.against('bedside', master, 'n', { at: X(650), abs: true });
  b.against('bedside', master, 'n', { at: X(3150), abs: true });
  b.against('wardrobe', master, 'w', { at: Y(8300), abs: true });
  b.against('bath', bath, 'e', { at: Y(7500), abs: true });
  b.against('shower_900', bath, 'n', { at: 'start' });
  b.against('vanity_single', bath, 's', { at: X(5900), abs: true });
  b.against('toilet', bath, 's', { at: X(6900), abs: true });
  b.against('laundry_tub', laundry, 'e', { at: Y(7700), abs: true });
  b.against('washer', laundry, 'e', { at: Y(8550), abs: true });
  b.against('dryer', laundry, 'e', { at: Y(9170), abs: true });
  b.against('tv_unit', living, 'e', { at: Y(8300), abs: true, w: 1500 });
  b.place('sofa_3', X(10300), Y(8300), 270);
  b.place('rug', X(11300), Y(8300), 0, { w: 1600, d: 2200 });
  b.place('coffee_table', X(11300), Y(8300), 90);
  void hall;

  // Existing rainwater tank beside the house.
  b.run('add_tank', { x: X(14500), y: Y(2200), capacity_l: 5000, status: 'existing' });

  // Everything drawn so far is existing.
  b.run('set_status', { ids: ['*'], status: 'existing' });

  // ---------------------------------------------------------------- new work
  const family = R('family', 'Family room', 600, -4800, 5400, 0, { status: 'new' });
  const deck = R('deck', 'Deck', 1200, -7800, 5400, -4800, { status: 'new', balustrade: true });
  b.opening('sliding_door_3000', family, 'n', X(3000), { abs: true });
  b.opening('window_sliding_1800', family, 'w', Y(-2400), { abs: true });
  b.opening('window_sliding_1200', family, 'e', Y(-1000), { abs: true });
  b.against('tv_unit', family, 'e', { at: Y(-2400), abs: true });
  b.place('sofa_l', X(2900), Y(-2400), 270);
  b.place('rug', X(3200), Y(-2400), 0, { w: 2400, d: 1600 });
  b.place('coffee_table', X(4100), Y(-2400), 90);
  b.place('plant', X(1100), Y(-900), 0);
  b.place('outdoor_table', X(3300), Y(-6500), 0);
  b.against('bbq', deck, 'n', { at: X(4700), abs: true });
  void deck;

  // The existing kitchen's rear wall opens into the new family room: demolish a 3 m section.
  const section = b.splitWall(X(1500), Y(0), X(4500), Y(0));
  if (!section) throw new Error('Extension template: rear wall section not found');
  b.run('update_wall', { id: section.id, status: 'demolish' });
  return b.done();
}
