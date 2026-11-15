// Zone lookup for a lot that was opened without one (a saved design, "My home", an uploaded boundary with a georeference). The lot response from
// /api/site/lot carries the land zone; a lot kept from an earlier visit may not have it, so the commercial panel asks again when the design is
// in commercial mode (src/commercial/ui/panel-commercial.js) instead of leaving "zone not looked up".
import { getLot } from '../site/client.js';
import { mgaToLonLat, zoneForSrid } from '../site/geo.js';

/** True when this lot has no zone and could be looked up (NSW, with a georeference). Queensland zones are not looked up by the service. */
export function needsZone(lot) {
  return !!lot && !lot.zoning && lot.state !== 'QLD' && Number.isFinite(lot.origin?.e) && Number.isFinite(lot.origin?.n) && zoneForSrid(Number(lot.srid)) != null;
}

/** A key for "already asked for this lot", so one lot is asked once per switch to commercial. */
export const lotKey = (lot) => [lot?.origin?.e, lot?.origin?.n, lot?.lotLabel].join('|');

/**
 * Ask for the zone and write it to the lot as one undo step. Resolves 'found', 'none' (the service has no zone for this lot) or 'failed'.
 * `lookup` is the lot service call (injected in tests).
 */
export async function ensureZone(store, { lookup = getLot } = {}) {
  const lot = store.project?.site?.lot;
  if (!needsZone(lot)) return 'found';
  const key = lotKey(lot);
  try {
    const { lon, lat } = mgaToLonLat(lot.origin.e, lot.origin.n, zoneForSrid(Number(lot.srid)));
    const r = await lookup({ lon, lat, ...(lot.state ? { state: lot.state } : {}) });
    const now = store.project?.site?.lot;
    if (!now || lotKey(now) !== key) return 'failed'; // the person moved to another lot meanwhile
    if (!r?.zoning) return 'none';
    store.apply('Look up zone', (p) => {
      p.site.lot.zoning = r.zoning;
      p.site.lot.zoneNote = null;
      if (!p.site.lot.lga && r.lga) p.site.lot.lga = r.lga;
    });
    return 'found';
  } catch {
    return 'failed';
  }
}
