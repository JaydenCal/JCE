// Default commercial rules per zone class. Every value is INDICATIVE only: it is a starting point when no council rule loads,
// never a confirmed control, and every message built from it says "check with council".

export const INDICATIVE = 'indicative, check with council';

export const DEFAULT_RULES = Object.freeze({
  industrial: Object.freeze({
    label: 'Industrial',
    setbacks: Object.freeze({ front: 10, secondaryFront: 5, side: 3, rear: 3 }),
    landscapeMinPct: 10,
    coverageMaxPct: 70,
    parkingPerM2Gfa: 0.01,
    note: INDUSTRIAL_NOTE(),
  }),
  commercial: Object.freeze({
    label: 'Commercial',
    setbacks: Object.freeze({ front: 3, secondaryFront: 3, side: 0, rear: 3 }),
    landscapeMinPct: 5,
    coverageMaxPct: 80,
    parkingPerM2Gfa: 0.01,
    note: 'Default commercial table, indicative, check with council',
  }),
});

function INDUSTRIAL_NOTE() { return 'Default industrial table, indicative, check with council'; }

/** Default parking rate: 1 space per 100 m2 of GFA. */
export const DEFAULT_PARKING_RATE = 0.01;

/**
 * Accessible parking rate table (data). Default: 1 accessible bay per 100 total bays or part thereof.
 * The owner is to verify this against NCC Part D4 and AS 2890.6 before it is relied on.
 */
export const ACCESSIBLE_RATE = Object.freeze({
  perBays: 100,
  basis: 'Indicative: 1 accessible bay per 100 bays or part thereof, owner to verify against NCC Part D4 and AS 2890.6',
});

export const ACCESSIBLE_BAY = Object.freeze({ widthMm: 2400, lengthMm: 5400, sharedZoneMm: 2400, headroomMm: 2500 });

/** Accessible bays required for a total bay count (total includes the accessible bays). */
export function accessibleRequired(totalBays, table = ACCESSIBLE_RATE) {
  if (!(totalBays > 0)) return 0;
  return Math.max(1, Math.ceil(totalBays / table.perBays));
}

export function defaultRulesFor(cls) {
  return DEFAULT_RULES[cls] || DEFAULT_RULES.commercial;
}
