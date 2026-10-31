// Sample projects for the 3D viewer tests and the viewer test page.
// Every project is built through the ops registry, the same way the app and the AI edit a design.

import { createProject } from '../model/schema.js';
import { applyOp } from '../model/ops.js';

function runner(project) {
  return (op, args) => applyOp(project, op, args || {}, {});
}

// Single storey L shaped house: bar along the north, leg to the south-west, deck in the crook,
// attached garage and a rainwater tank. Furniture ids match the catalogue (grey boxes without it).
export function lHouse({ furniture = true } = {}) {
  const p = createProject({ type: 'house', name: 'L shaped house' });
  const run = runner(p);
  run('add_room', { name: 'Living', type: 'living', x: 0, y: 0, width: 5500, depth: 5200 });
  run('add_room', { name: 'Kitchen', type: 'kitchen', x: 5500, y: 0, width: 4500, depth: 5200 });
  run('add_room', { name: 'Garage', type: 'garage', x: 10000, y: 0, width: 3500, depth: 5200 });
  run('add_room', { name: 'Bed 1', type: 'bedroom', x: 0, y: 5200, width: 3500, depth: 4000 });
  run('add_room', { name: 'Bath', type: 'bathroom', x: 3500, y: 5200, width: 2000, depth: 2000 });
  run('add_room', { name: 'Laundry', type: 'laundry', x: 3500, y: 7200, width: 2000, depth: 2000 });
  const deck = run('add_room', { name: 'Deck', type: 'deck', x: 5500, y: 5200, width: 4500, depth: 3200 });
  run('update_room', { id: deck.id, balustrade: true });

  run('add_opening', { kind: 'window', x: 2750, y: 0, width: 2400 });
  run('add_opening', { kind: 'door', x: 0, y: 2600 });
  run('add_opening', { kind: 'window', x: 7750, y: 0, width: 1800 });
  run('add_opening', { kind: 'sliding_door', x: 7750, y: 5200, width: 2400 });
  run('add_opening', { kind: 'window', x: 0, y: 7200 });
  run('add_opening', { kind: 'window', x: 1750, y: 9200, width: 1500 });
  run('add_opening', { kind: 'window', x: 5500, y: 6200, width: 600, height: 600, sill: 1500, style: 'awning' });
  run('add_opening', { kind: 'door', x: 5500, y: 7800 });
  run('add_opening', { kind: 'garage_door', x: 13500, y: 2600, width: 4200 });
  run('add_opening', { kind: 'door', x: 5500, y: 2600 });
  run('add_opening', { kind: 'door', x: 10000, y: 4200 });
  run('add_opening', { kind: 'door', x: 1750, y: 5200 });
  run('add_opening', { kind: 'door', x: 3500, y: 6000 });
  run('add_opening', { kind: 'opening', x: 4500, y: 7200, width: 900 });

  if (furniture) {
    run('add_furniture', { item: 'sofa_3', x: 2750, y: 3500, rotation: 180 });
    run('add_furniture', { item: 'coffee_table', x: 2750, y: 2400 });
    run('add_furniture', { item: 'tv_unit', x: 2750, y: 500 });
    run('add_furniture', { item: 'kitchen_island', x: 7750, y: 2600 });
    run('add_furniture', { item: 'fridge', x: 9500, y: 450 });
    run('add_furniture', { item: 'bed_queen', x: 1750, y: 7000 });
    run('add_furniture', { item: 'wardrobe', x: 1750, y: 8800 });
    run('add_furniture', { item: 'toilet', x: 4900, y: 6700 });
    run('add_furniture', { item: 'washer', x: 4700, y: 8800 });
    run('add_furniture', { item: 'car_sedan', x: 11750, y: 2600 });
    run('add_furniture', { item: 'outdoor_table', x: 7700, y: 6800 });
  }
  run('add_tank', { x: -1300, y: 1800, capacity_l: 5000 });
  return p;
}

// Two storeys with a single storey garage wing, so the ground roof meets the first floor walls.
export function twoStorey() {
  const p = createProject({ type: 'house', name: 'Two storey' });
  const run = runner(p);
  run('add_room', { name: 'Living', type: 'living', x: 0, y: 0, width: 6000, depth: 7000 });
  run('add_room', { name: 'Kitchen', type: 'kitchen', x: 6000, y: 0, width: 4000, depth: 4500 });
  run('add_room', { name: 'Hall', type: 'hall', x: 6000, y: 4500, width: 4000, depth: 2500 });
  run('add_room', { name: 'Garage', type: 'garage', x: 10000, y: 0, width: 3500, depth: 7000 });
  run('add_opening', { kind: 'door', x: 8000, y: 7000 });
  run('add_opening', { kind: 'window', x: 3000, y: 0, width: 2400 });
  run('add_opening', { kind: 'window', x: 0, y: 3500, width: 1800 });
  run('add_opening', { kind: 'garage_door', x: 13500, y: 3500, width: 4200 });
  run('add_opening', { kind: 'door', x: 6000, y: 3000 });
  const up = run('add_level', { name: 'First', copy_outline: false });
  const L = up.id;
  run('add_room', { level: L, name: 'Bed 1', type: 'bedroom', x: 0, y: 0, width: 4500, depth: 4000 });
  run('add_room', { level: L, name: 'Bed 2', type: 'bedroom', x: 4500, y: 0, width: 3000, depth: 4000 });
  run('add_room', { level: L, name: 'Bath', type: 'bathroom', x: 7500, y: 0, width: 2500, depth: 4000 });
  run('add_room', { level: L, name: 'Bed 3', type: 'bedroom', x: 0, y: 4000, width: 4000, depth: 3000 });
  run('add_room', { level: L, name: 'Landing', type: 'hall', x: 4000, y: 4000, width: 6000, depth: 3000 });
  run('add_opening', { level: L, kind: 'window', x: 2250, y: 0, width: 2100 });
  run('add_opening', { level: L, kind: 'window', x: 6000, y: 0, width: 1500 });
  run('add_opening', { level: L, kind: 'window', x: 0, y: 5500, width: 1500 });
  run('add_opening', { level: L, kind: 'sliding_door', x: 7000, y: 7000, width: 2400 });
  run('add_opening', { level: L, kind: 'door', x: 4500, y: 2000 });
  run('add_stair', { level: 'Ground', x: 7000, y: 5750, width: 1000, length: 3600, rotation: 90 });
  run('set_roof', { level: L, type: 'hip', pitch: 25, overhang: 500 });
  run('set_roof', { level: 'Ground', type: 'skillion', pitch: 8, overhang: 400 });
  return p;
}

// A shed drawn with loose walls only: no rooms.
export function shed() {
  const p = createProject({ type: 'shed', name: 'Workshop shed' });
  const run = runner(p);
  run('add_wall', { x1: 0, y1: 0, x2: 6000, y2: 0 });
  run('add_wall', { x1: 6000, y1: 0, x2: 6000, y2: 4000 });
  run('add_wall', { x1: 6000, y1: 4000, x2: 0, y2: 4000 });
  run('add_wall', { x1: 0, y1: 4000, x2: 0, y2: 0 });
  run('add_opening', { kind: 'roller_door', x: 3000, y: 4000, width: 3000, height: 2700 });
  run('add_opening', { kind: 'window', x: 3000, y: 0, width: 1500 });
  run('add_opening', { kind: 'door', x: 6000, y: 2000 });
  return p;
}

// An extension: existing rooms, a room to demolish and new work, with statuses on rooms, walls and openings.
export function extension() {
  const p = createProject({ type: 'extension', name: 'Extension' });
  const run = runner(p);
  run('add_room', { name: 'Living', type: 'living', x: 0, y: 0, width: 6000, depth: 4500, status: 'existing' });
  run('add_room', { name: 'Bed', type: 'bedroom', x: 6000, y: 0, width: 3500, depth: 3000, status: 'existing' });
  run('add_room', { name: 'Bath', type: 'bathroom', x: 6000, y: 3000, width: 3500, depth: 1500, status: 'existing' });
  run('add_room', { name: 'Old sunroom', type: 'other', x: 0, y: 4500, width: 3000, depth: 3000, status: 'demolish' });
  run('add_room', { name: 'Family', type: 'living', x: 3000, y: 4500, width: 6500, depth: 4000, status: 'new' });
  run('add_opening', { kind: 'window', x: 3000, y: 0, width: 2400, status: 'existing' });
  run('add_opening', { kind: 'window', x: 7750, y: 0, width: 1500, status: 'existing' });
  run('add_opening', { kind: 'sliding_door', x: 6250, y: 8500, width: 3000, status: 'new' });
  run('add_opening', { kind: 'window', x: 0, y: 6000, status: 'demolish' });
  run('add_opening', { kind: 'door', x: 4500, y: 4500, status: 'new' });
  return p;
}

// About 300 m2 on one storey, for performance checks: 20 m by 15 m with 15 rooms.
export function bigHouse() {
  const p = createProject({ type: 'house', name: 'Large house' });
  const run = runner(p);
  const rooms = [
    ['Living', 'living', 0, 0, 7000, 6000], ['Kitchen', 'kitchen', 7000, 0, 5000, 6000], ['Dining', 'dining', 12000, 0, 4000, 6000],
    ['Garage', 'garage', 16000, 0, 4000, 6000], ['Bed 1', 'bedroom', 0, 6000, 4500, 4500], ['Ensuite', 'ensuite', 4500, 6000, 2500, 3000],
    ['Robe', 'robe', 4500, 9000, 2500, 1500], ['Bed 2', 'bedroom', 7000, 6000, 4000, 4500], ['Bath', 'bathroom', 11000, 6000, 2500, 3000],
    ['Laundry', 'laundry', 11000, 9000, 2500, 1500], ['Bed 3', 'bedroom', 13500, 6000, 3500, 4500], ['Study', 'study', 17000, 6000, 3000, 4500],
    ['Hall', 'hall', 0, 10500, 20000, 1500], ['Alfresco', 'alfresco', 0, 12000, 7000, 3000], ['Deck', 'deck', 7000, 12000, 6000, 3000],
  ];
  for (const [name, type, x, y, width, depth] of rooms) run('add_room', { name, type, x, y, width, depth });
  const windows = [[3500, 0], [9500, 0], [14000, 0], [0, 3000], [0, 8000], [2250, 10500], [7000, 8000], [9000, 10500], [13500, 8000], [15250, 10500], [20000, 8000], [18500, 10500], [20000, 3000]];
  for (const [x, y] of windows) run('add_opening', { kind: 'window', x, y, width: 1500 });
  const doors = [[7000, 3000], [12000, 3000], [16000, 3000], [2000, 6000], [8000, 6000], [12000, 6000], [14500, 6000], [18000, 6000], [4500, 7500], [11000, 7500]];
  for (const [x, y] of doors) run('add_opening', { kind: 'door', x, y });
  run('add_opening', { kind: 'garage_door', x: 18000, y: 0, width: 4800 });
  run('add_opening', { kind: 'sliding_door', x: 10000, y: 12000, width: 2400 });
  const items = ['sofa_3', 'coffee_table', 'tv_unit', 'kitchen_island', 'fridge', 'bed_queen', 'wardrobe', 'bed_double', 'bedside', 'toilet', 'vanity_single', 'washer', 'car_sedan', 'desk', 'bookshelf'];
  items.forEach((item, i) => run('add_furniture', { item, x: 1500 + ((i * 3700) % 17000), y: 1500 + ((i * 2300) % 9000), rotation: (i * 67) % 360 }));
  return p;
}

export const SAMPLES = { lHouse, twoStorey, shed, extension, bigHouse };
