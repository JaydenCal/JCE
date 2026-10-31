// Active tool and each tool's remembered argument (armed furniture item, opening preset, tank size...).

import { DOOR_FAMILY } from '../editor2d/tools-meta.js';

const remembered = {};
const DEFAULT_ARG = { tank: 5000, deck: 'deck', status: 'existing' };

export function toolArgFor(tool) {
  return remembered[tool] ?? DEFAULT_ARG[tool] ?? null;
}

// Switch tool. `arg` overrides the remembered argument.
export function setTool(store, tool, arg) {
  if (arg !== undefined) remembered[tool] = arg;
  const patch = { tool, toolArg: toolArgFor(tool) };
  if (store.ui.view !== '2d') patch.view = '2d';
  store.setUI(patch);
}

export function setToolArg(store, arg) {
  remembered[store.ui.tool] = arg;
  store.setUI({ toolArg: arg });
}

// Opening tools share one preset list per kind; switching kind keeps the armed size where it exists.
export function isDoorFamily(tool) {
  return DOOR_FAMILY.includes(tool);
}
