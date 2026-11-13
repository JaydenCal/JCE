// Default commercial rules per zone class. Every value is INDICATIVE only: it is a starting point when no council rule loads,
// never a confirmed control, and every message built from it says "check with council".

import { PARKING_M2_PER_SPACE, OFFICE_M2_PER_SPACE, accessibleBaysFor, facts } from './dataset.js';

export const INDICATIVE = 'indicative, check with council';

export const DEFAULT_RULES = Object.freeze({
  industrial: Object.freeze({
    label: 'Industrial',
    setbacks: Object.freeze({ front: 10, secondaryFront: 5, side: 3, rear: 3 }),
    landscapeMinPct: 10,
    coverageMaxPct: 70,
    parkingPerM2Gfa: 1 / PARKING_M2_PER_SPACE,
    note: INDUSTRIAL_NOTE(),
  }),
  commercial: Object.freeze({
    label: 'Commercial',
    setbacks: Object.freeze({ front: 3, secondaryFront: 3, side: 0, rear: 3 }),
    landscapeMinPct: 5,
    coverageMaxPct: 80,
    parkingPerM2Gfa: 1 / PARKING_M2_PER_SPACE,
    note: 'Default commercial table, indicative, check with council',
  }),
});

function INDUSTRIAL_NOTE() { return 'Default industrial table, indicative, check with council'; }

/** Default parking rate: 1 space per 75 m2 of GFA including mezzanine (unit complexes, Tamworth DCP and the Gunnedah DCP 2025 industry rate), office 1 per 40 m2. */
export const DEFAULT_PARKING_RATE = 1 / PARKING_M2_PER_SPACE;
export const DEFAULT_OFFICE_RATE = 1 / OFFICE_M2_PER_SPACE;

/**
 * Accessible parking rate table, from the dataset (NCC 2022 Volume One D4D6(2)): Class 5, 7 and 8 are 1 per 100 bays or part thereof,
 * Class 6 is 1 per 50 up to 1000 bays. Status is VERIFIED_PRIMARY for the ratio, the AS 2890.6 edition called up is UNVERIFIED.
 */
export const ACCESSIBLE_RATE = Object.freeze({
  perBays: 100,
  basis: 'NCC 2022 D4D6(2), 1 accessible bay per 100 bays or part thereof for Class 5, 7 and 8, 1 per 50 for Class 6, owner to verify the AS 2890.6 edition called up',
});

export const ACCESSIBLE_BAY = Object.freeze({ widthMm: 2400, lengthMm: 5400, sharedZoneMm: 2400, headroomMm: 2500, bollardFromEntryMm: 800 });

/** Accessible bays required for a total bay count. `table` is { perBays } or an NCC class key ('class_6'). */
export function accessibleRequired(totalBays, table = 'class_8') {
  if (typeof table === 'string') return accessibleBaysFor(totalBays, table);
  if (!(totalBays > 0)) return 0;
  return Math.max(1, Math.ceil(totalBays / (table.perBays || 100)));
}

export { facts };

export function defaultRulesFor(cls) {
  return DEFAULT_RULES[cls] || DEFAULT_RULES.commercial;
}
