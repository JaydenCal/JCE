// When no council setback rule loads for a lot (no rule for the zone, or the data could not be read), the viewer still keeps the house
// inside the lot: it fits against this DEFAULT indicative envelope built from the real boundary and frontage. It is never presented as a
// confirmed setback (the card says "Setbacks not confirmed, check with council").

import { envelopeOf } from '../model/placement.js';

export const DEFAULT_SETBACKS = { front: 6, secondaryFront: 3, side: 0.9, rear: 3 };

/** The default envelope polygon (plan mm) for the lot, or null when the lot shape or frontage does not allow one. */
export function defaultEnvelope(lot) {
  if (!lot || !Array.isArray(lot.boundary) || lot.boundary.length < 3 || !(lot.frontEdges || []).length) return null;
  const setbacks = { ...DEFAULT_SETBACKS, secondaryFront: lot.cornerLot ? DEFAULT_SETBACKS.secondaryFront : null, edgeKinds: undefined };
  const e = envelopeOf({ ...lot, setbacks, envelope: null });
  return e.polygon && e.polygon.length >= 3 ? e.polygon : null;
}

// Zones where a dwelling is normally permitted: residential R1 to R5, village RU5, environmental living E4, large lot LLR, mixed use MU1, and
// any zone whose name says residential, village or living (Queensland names). Anything else gets a note on the card.
const DWELLING_CODE = /^(R[1-5]|RU5|E4|LLR|MU1)$/i;
const DWELLING_NAME = /residential|village|living/i;

/** "This zone may not permit a dwelling, check with council" for a zone that is not a residential one, else ''. */
export function zoneDwellingNote(lot) {
  const z = lot?.zoning;
  const code = String(z?.code || '').trim();
  const name = String(z?.name || '');
  if (!code && !name) return '';
  if (DWELLING_CODE.test(code) || DWELLING_NAME.test(name)) return '';
  return 'This zone may not permit a dwelling, check with council';
}
