// Wording the plan set sheets carry for an uploaded boundary and for Mapbox imagery. Pure.

export const USER_BOUNDARY_SENTENCE = 'Boundary supplied by user, not checked against title.';
export const MAPBOX_CREDIT = '© Mapbox © OpenStreetMap';

export const isUpload = (lot) => !!lot && lot.source === 'upload';
export const isMapboxAerial = (aerial, lot = null) => /mapbox/i.test(`${aerial?.source || ''} ${aerial?.attribution || ''} ${lot?.aerial?.source || ''} ${lot?.provenance?.aerial?.source || ''}`);

const CADASTRE = /cadastre|DCDB/i;

/**
 * The notes for a sheet. For an uploaded boundary a note that says the boundary is from the cadastre is replaced by the user boundary
 * sentence (and the surveyor line kept), and on a sheet that shows the aerial the Mapbox credit is added when the picture is Mapbox's.
 */
export function sheetNotes(notes, lot, { aerialShown = false, aerial = null } = {}) {
  if (!isUpload(lot)) return notes;
  const out = [];
  let said = false;
  for (const n of notes || []) {
    if (CADASTRE.test(n) && /boundar/i.test(n)) {
      if (!said) out.push(`${USER_BOUNDARY_SENTENCE} Dimensions and areas must be confirmed by a registered surveyor.`);
      said = true;
    } else out.push(n);
  }
  if (!said) out.push(USER_BOUNDARY_SENTENCE);
  if (aerialShown && isMapboxAerial(aerial, lot)) out.push(`Aerial: ${MAPBOX_CREDIT}.`);
  return out;
}
