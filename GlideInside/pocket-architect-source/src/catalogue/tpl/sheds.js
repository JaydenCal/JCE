// Shed templates: garage and workshop, and a farm machinery shed.

import { plan } from './kit.js';

export function shedWorkshop() {
  const b = plan({ name: 'Shed: garage and workshop', type: 'shed' });
  const shed = b.room('workshop', 'Garage and workshop', 0, 0, 9000, 7000);

  // Two roller doors and a personal access door.
  b.opening('roller_door_2700', shed, 's', 2100);
  b.opening('roller_door_2700', shed, 's', 5400);
  b.opening('door_personal_access', shed, 'e', 5800);
  b.opening('window_kitchen_1800', shed, 'n', 6300);

  // Car nose first in the left bay; bench under the window; shelving on the west wall.
  b.place('car_sedan', 2100, 3500, 180);
  b.against('workbench', shed, 'n', { at: 6300, abs: true });
  b.against('shelving', shed, 'w', { at: 'start', margin: 250 });
  b.against('shelving', shed, 'e', { at: 'start', margin: 250 });

  b.finish('roof', 'corrugated', 'steel-off-white');
  return b.done();
}

export function shedFarm() {
  const b = plan({ name: 'Farm machinery shed', type: 'shed' });
  b.run('update_level', { id: b.project.levels[0].id, ceiling_height: 4200 });
  const shed = b.room('workshop', 'Machinery shed', 0, 0, 15000, 9000);

  // Three roller doors on the long side, evenly spaced.
  for (const x of [2850, 7500, 12150]) b.opening('roller_door_3600', shed, 's', x);
  b.opening('door_personal_access', shed, 'e', 7500);

  b.place('car_ute', 2850, 3900, 180);
  b.against('workbench', shed, 'n', { at: 12000, abs: true });
  b.against('shelving', shed, 'w', { at: 'start', margin: 400 });
  b.against('shelving', shed, 'n', { at: 9000, abs: true, w: 1800 });

  b.tank(17500, 2300, 22500, 'steel-sage');
  b.finish('external_walls', 'corrugated', 'steel-light-grey');
  b.finish('roof', 'corrugated', 'steel-gum-green');
  return b.done();
}
