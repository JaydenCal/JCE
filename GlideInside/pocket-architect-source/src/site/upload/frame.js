// The ground frame a lot lives in. Inside NSW and Queensland a lot uses MGA2020 (as every looked up lot does), so the state imagery and
// setback code work unchanged. Anywhere else the lot gets a local transverse mercator frame centred on its own longitude: metres, north up,
// no state grid needed. Both give { e, n } in metres, and the lot origin is a point in that frame.

import { lonLatToMga, mgaToLonLat, mgaZoneForLon, mgaSrid } from '../geo.js';
import proj4 from '../../lib/proj4.cjs';
import { localTmDef } from './crs.js';

// Rough outlines of the two states, enough to choose imagery (not for legal use). [lon, lat] corners, closed implicitly.
const NSW = [[141.0, -29.0], [148.9, -29.0], [150.5, -28.9], [152.0, -28.9], [153.45, -28.15], [153.55, -30.0], [153.0, -32.0], [152.0, -33.0], [151.3, -34.2], [150.8, -35.2], [150.0, -37.0], [149.98, -37.51], [148.5, -36.8], [147.0, -36.0], [145.5, -36.0], [144.8, -35.95], [143.6, -35.3], [142.1, -34.15], [141.0, -34.0]];
const QLD = [[141.0, -29.0], [148.9, -29.0], [150.5, -28.9], [152.0, -28.9], [153.45, -28.15], [153.6, -26.0], [153.0, -25.0], [152.0, -23.5], [150.5, -22.0], [149.0, -20.5], [147.0, -19.0], [146.3, -17.5], [145.5, -15.0], [143.9, -14.0], [143.5, -11.5], [142.5, -10.6], [141.5, -12.5], [141.5, -15.0], [139.5, -17.2], [138.0, -16.5], [138.0, -26.0], [141.0, -26.0]];

function inside(lon, lat, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** 'NSW', 'QLD' or null for a point (rough outlines). */
export function stateAt(lon, lat) {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  if (inside(lon, lat, NSW)) return 'NSW';
  if (inside(lon, lat, QLD)) return 'QLD';
  return null;
}

/** The frame for a lot centred at lon, lat: { kind: 'mga', zone, state } in NSW and Queensland, else { kind: 'tm', lon0 }. */
export function frameFor(lon, lat, { forceLocal = false } = {}) {
  const st = forceLocal ? null : stateAt(lon, lat);
  if (st) return { kind: 'mga', zone: mgaZoneForLon(lon), state: st };
  return { kind: 'tm', lon0: Math.round(lon * 10000) / 10000, state: '' };
}

/** [lon, lat] to { e, n } in the frame. */
export function lonLatToFrame(frame, lon, lat) {
  if (frame.kind === 'mga') {
    const m = lonLatToMga(lon, lat, frame.zone);
    return { e: m.e, n: m.n };
  }
  const p = proj4('EPSG:4326', localTmDef(frame.lon0), [lon, lat]);
  return { e: p[0], n: p[1] };
}

/** { e, n } in the frame to { lon, lat }. */
export function frameToLonLat(frame, e, n) {
  if (frame.kind === 'mga') return mgaToLonLat(e, n, frame.zone);
  const p = proj4(localTmDef(frame.lon0), 'EPSG:4326', [e, n]);
  return { lon: p[0], lat: p[1] };
}

/** srid and zone to store on the lot (null for a local frame). */
export const sridOf = (frame) => (frame.kind === 'mga' ? { srid: mgaSrid(frame.zone), zone: frame.zone } : { srid: null, zone: null });

/** True when the lot's frame is MGA (the state services can be asked about it). */
export const isMgaLot = (lot) => !!lot && Number.isFinite(Number(lot.srid)) && Number(lot.srid) > 0 && lot.frame?.kind !== 'tm';
