// Put an uploaded boundary on the open project: the aerial for the site (state imagery inside NSW and Queensland, Mapbox elsewhere, or a grey
// ground), the lot, and the same follow on steps as a looked up lot (frontage step, commercial offer). One undo step.

import { storeAerials, commitLot } from '../apply.js';
import { lotResponseFromPolygons, buildUploadedLot } from './lot.js';
import { loadAerialForLot, mapboxToken, ensureMapboxToken, NO_AERIAL_TEXT } from '../mapbox-aerial.js';
import { fetchAerial } from '../client.js';

/**
 * applyUploadedBoundary(store, { polys, name, merge, forceLocal, forceMapbox, currency }, { onStep, signal, fetchImpl, stateFetch, ... })
 * polys are longitude and latitude polygons (see toLonLatPolygons). Returns { lot, warnings, aerialSource }.
 */
export async function applyUploadedBoundary(store, input, { onStep, signal, fetchImpl, stateFetch = null, createCanvas, decode, token = undefined, ensureToken = true } = {}) {
  onStep?.('lot');
  const built = lotResponseFromPolygons(input);
  const commercial = store.project.mode === 'commercial';
  if (ensureToken) await ensureMapboxToken({ fetchImpl });
  const tok = token === undefined ? mapboxToken() : token;
  // A provisional lot (no aerial yet) gives the origin and srid the state imagery request needs.
  const probe = { srid: built.resp.srid, origin: built.resp.origin };
  const got = await loadAerialForLot({
    lot: probe, frame: built.frame, bbox: built.bbox, token: tok, forceMapbox: !!input.forceMapbox, fetchImpl, signal, createCanvas, decode, onStep,
    stateFetch: stateFetch || ((params) => fetchAerial(params, { signal, fetchImpl })),
  });
  const warnings = [...got.warnings];
  const res = { aerial: got.aerial, aerialWide: got.aerialWide };
  const { aerialKey, aerialWideKey } = await storeAerials(store, res, warnings);
  const lot = buildUploadedLot(built, {
    aerialMeta: aerialKey ? got.aerial.meta : null, aerialKey,
    aerialWideMeta: aerialWideKey ? got.aerialWide.meta : null, aerialWideKey,
    warnings, commercial, forceCustom: !!input.customRules, currency: input.currency || 'AUD',
  });
  lot.aerialSource = got.source;
  if (!lot.aerial) lot.aerialNote = NO_AERIAL_TEXT;
  commitLot(store, lot, { label: 'Upload boundary', aerialKey, aerialWideKey });
  return { lot, warnings, aerialSource: got.source };
}
