// The shared catalogue object. index.js adds the templates to it, so templates can pass the same
// object to the operations registry (ctx.catalogue) without a circular import.

import { FURNITURE, CATEGORIES, getFurniture } from './furniture.js';
import * as finishes from './finishes.js';
import { OPENING_PRESETS, presetsFor } from './openings.js';
import { TANKS } from './tanks.js';

export const catalogue = {
  FURNITURE,
  CATEGORIES,
  getFurniture,
  finishes,
  validateFinish: finishes.validateFinish,
  openings: { OPENING_PRESETS, presetsFor },
  tanks: { TANKS },
};
