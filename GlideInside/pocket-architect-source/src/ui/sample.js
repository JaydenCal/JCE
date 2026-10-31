// A small built-in plan. Used only when the template catalogue cannot be loaded, so the first frame
// is never an empty canvas.

import { createProject } from '../model/schema.js';
import { applyOp } from '../model/ops.js';

export function createSampleProject() {
  const p = createProject({ name: 'Sample house', type: 'house' });
  const run = (op, args) => {
    try {
      return applyOp(p, op, args, {});
    } catch (e) {
      console.warn(`[sample] ${op} skipped: ${e.message}`);
      return null;
    }
  };
  run('add_room', { name: 'Living', type: 'living', x: 0, y: 0, width: 5400, depth: 4200 });
  run('add_room', { name: 'Kitchen', type: 'kitchen', x: 5400, y: 0, width: 3600, depth: 4200 });
  run('add_room', { name: 'Bed 1', type: 'bedroom', x: 0, y: 4200, width: 3600, depth: 3600 });
  run('add_room', { name: 'Bathroom', type: 'bathroom', x: 3600, y: 4200, width: 2400, depth: 3600 });
  run('add_room', { name: 'Bed 2', type: 'bedroom', x: 6000, y: 4200, width: 3000, depth: 3600 });
  run('add_room', { name: 'Deck', type: 'deck', x: 1200, y: 7800, width: 4800, depth: 2400 });
  run('add_opening', { kind: 'window', x: 2700, y: 0 });
  run('add_opening', { kind: 'window', x: 7200, y: 0 });
  run('add_opening', { kind: 'window', x: 0, y: 2100 });
  run('add_opening', { kind: 'door', x: 9000, y: 2100, width: 920 });
  run('add_opening', { kind: 'door', x: 1000, y: 4200 });
  run('add_opening', { kind: 'door', x: 4800, y: 4200 });
  run('add_opening', { kind: 'door', x: 7500, y: 4200 });
  run('add_opening', { kind: 'window', x: 1800, y: 7800 });
  run('add_opening', { kind: 'window', x: 4800, y: 7800, width: 900 });
  run('add_opening', { kind: 'window', x: 7500, y: 7800 });
  return p;
}

export const SAMPLE_TEMPLATE = {
  id: 'sample',
  name: 'Sample house',
  type: 'house',
  description: 'A small three room house with a deck, to try the tools on.',
  levels: 1,
  create: createSampleProject,
};
