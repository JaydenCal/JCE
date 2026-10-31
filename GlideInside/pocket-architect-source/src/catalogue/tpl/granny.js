// Granny flat: about 60 m2, two bedrooms, open living, kitchen and dining, front deck 2.4 m deep.
// Coordinates are polygon centre lines. The front (deck) faces south.

import { plan } from './kit.js';

export function grannyFlat() {
  const b = plan({ name: 'Granny flat, 2 bedroom', type: 'unit' });

  // North row (y 0..3200) and south row (y 3200..6400), overall 9600 x 6400.
  const bed2 = b.room('bedroom', 'Bed 2', 0, 0, 3000, 3200);
  const hall = b.room('hall', 'Hall', 3000, 0, 1100, 3200);
  const bath = b.room('bathroom', 'Bathroom', 4100, 0, 1500, 3200);
  const bed1 = b.room('bedroom', 'Bed 1', 5600, 0, 4000, 3200);
  const laundry = b.room('laundry', 'Laundry', 0, 3200, 1600, 3200);
  const kitchen = b.room('kitchen', 'Kitchen and dining', 1600, 3200, 4000, 3200);
  const living = b.room('living', 'Living', 5600, 3200, 4000, 3200);
  const deck = b.room('deck', 'Deck', 4400, 6400, 5200, 2400, { walls: false });

  // Doors.
  b.door(bed2, 'e', 2500, { into: bed2 });
  b.door(bath, 'w', 1400, { preset: 'door_cavity' });
  b.door(bed1, 's', 6300, { abs: true, into: bed1 });
  b.door(laundry, 'e', 4700, { abs: true, into: laundry });
  b.opening('opening_900', hall, 's', 'c');
  b.opening('opening_900', kitchen, 'e', 4700, { abs: true });
  b.opening('door_entry', kitchen, 's', 5000, { abs: true, into: kitchen });
  b.opening('sliding_door_2100', living, 's', 8300, { abs: true });

  // Windows on external walls of habitable rooms, and the wet rooms.
  b.opening('window_sliding_1200', bed2, 'n', 'c');
  b.opening('window_sliding_1800', bed1, 'n', 'c');
  b.opening('window_awning_1200', bath, 'n', 'c');
  b.opening('window_awning_1200', laundry, 'w', 'c');
  b.opening('window_kitchen_1800', kitchen, 's', 2850, { abs: true });
  b.opening('window_sliding_1800', living, 'e', 'c');

  // Bed 2.
  b.against('bed_double', bed2, 'n', { at: 1500, abs: true });
  b.against('bedside', bed2, 'n', { at: 520, abs: true });
  b.against('bedside', bed2, 'n', { at: 2480, abs: true });
  b.against('wardrobe', bed2, 'w', { at: 1900, abs: true });

  // Bed 1.
  b.against('bed_queen', bed1, 'n', { at: 7600, abs: true });
  b.against('bedside', bed1, 'n', { at: 6560, abs: true });
  b.against('bedside', bed1, 'n', { at: 8640, abs: true });
  b.against('wardrobe', bed1, 'e', { at: 2200, abs: true });

  // Bathroom.
  b.against('shower_900', bath, 's', { at: 'end' });
  b.against('toilet', bath, 'e', { at: 1300, abs: true });
  b.against('vanity_single', bath, 'w', { at: 2400, abs: true });

  // Laundry.
  b.against('laundry_tub', laundry, 'n', { at: 'start' });
  b.against('washer', laundry, 's', { at: 500, abs: true });
  b.against('dryer', laundry, 's', { at: 1100, abs: true });

  // Kitchen and dining.
  b.against('kitchen_bench', kitchen, 's', { at: 'start', w: 2400 });
  b.against('fridge', kitchen, 'n', { at: 4800, abs: true });
  b.place('dining_4', 2300, 4300, 0);

  // Living.
  b.against('sofa_3', living, 'n', { at: 6900, abs: true });
  b.place('rug', 6900, 4850, 0, { w: 2400, d: 1500 });
  b.place('coffee_table', 6900, 4850, 0);
  b.against('tv_unit', living, 's', { at: 6400, abs: true, w: 1500 });
  b.place('armchair', 9000, 4600, 90);

  // Deck.
  b.place('outdoor_table', 5900, 7700, 0);
  b.place('sun_lounge', 8300, 8250, 90);

  b.tank(10900, 5200, 5000);
  b.run('set_finish', { target: 'external_walls', material: 'weatherboard', colour: 'paint-warm-white' });
  b.run('set_finish', { target: 'roof', material: 'corrugated', colour: 'steel-gum-green' });
  b.run('set_roof', { type: 'gable', pitch: 15, overhang: 450 });
  return b.done();
}
