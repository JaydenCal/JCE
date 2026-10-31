// Rainwater tanks: standard round sizes from the schema defaults (docs/SCOPE.md Appendix C).

import { DEFAULTS } from '../model/schema.js';

const withCommas = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export const TANKS = DEFAULTS.tanks.map((t) => ({
  id: `tank_${t.capacityL}`,
  name: `${withCommas(t.capacityL)} L round tank`,
  capacityL: t.capacityL,
  diameter: t.diameter,
  height: t.height,
}));

export const getTank = (capacityL) => TANKS.find((t) => t.capacityL === capacityL) || null;
