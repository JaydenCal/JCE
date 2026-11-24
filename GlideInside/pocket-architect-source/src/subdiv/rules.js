// Subdivision check: the minimum lot size and minimum frontage used for the indicative lot count. Pure, no DOM.
//
// The council LEP lot size map and the DCP subdivision controls are NOT in the data the app carries (the council rules hold setbacks, driveways
// and stormwater only). So the figure used here is always a labelled default for the zone, which the person can change. When a council figure
// is supplied (for example from a later data load) pass it as `councilMinM2` and the basis becomes 'council'.

import { classifyZone } from '../site/zone-class.js';

export const BASIS_TEXT = Object.freeze({
  council: 'From the council planning controls',
  default: 'Default for this zone, not a council figure. Change it if you know the council minimum',
  user: 'Entered by you',
});

// Typical minimum lot sizes (m2) by zone code. They are common NSW and Qld figures, not any one council's.
const BY_CODE = Object.freeze({
  R1: 450, R2: 600, R3: 450, R4: 450, R5: 20000, RU5: 600, LLR: 20000, C4: 10000,
  RU1: 400000, RU2: 400000, RU3: 400000, RU4: 400000, RU6: 20000,
  MU1: 600, B1: 600, B2: 600, B3: 600, B4: 600, B5: 600, B6: 1000, B7: 1000, E1: 600, E2: 600, E3: 1000,
  IN1: 1000, IN2: 1000, IN3: 1000, E4: 1000, E5: 2000,
});

// Queensland planning scheme zones are named, not coded in the same way.
const BY_NAME = Object.freeze([
  [/low[- ]medium density/i, 400], [/low density residential/i, 450], [/medium density|high density|character residential/i, 400],
  [/rural residential/i, 20000], [/emerging community|township/i, 600], [/limited development|conservation|environmental|open space|recreation/i, 400000],
  [/\brural\b/i, 400000], [/industry|industrial/i, 1000], [/centre|commercial|mixed use/i, 600],
]);

/** Minimum frontage (m) that suits a minimum lot area. A rule of thumb: a frontage wide enough for a driveway and a sensible lot shape. */
export function frontageFor(minM2) {
  if (minM2 <= 450) return 12;
  if (minM2 <= 700) return 15;
  if (minM2 <= 2000) return 20;
  if (minM2 <= 10000) return 30;
  return 40;
}

/**
 * The minimum lot size to use for a looked up lot.
 *   lot            site.lot (zoning {code, name}, state)
 *   userMinM2      a figure the person typed (wins over everything)
 *   councilMinM2   a figure from council data, when there is one
 * Returns { minM2, minFrontM, basis: 'council' | 'default' | 'user', basisText, zoneCode, zoneName, zoneKind, note }.
 */
export function minLotFor(lot, { userMinM2 = null, councilMinM2 = null } = {}) {
  const code = String(lot?.zoning?.code || '').trim().toUpperCase();
  const name = String(lot?.zoning?.name || '').trim();
  const kind = classifyZone(code, name);
  let basis = 'default';
  let minM2 = null;
  if (Number.isFinite(userMinM2) && userMinM2 >= 100) { minM2 = Math.round(userMinM2); basis = 'user'; }
  else if (Number.isFinite(councilMinM2) && councilMinM2 >= 100) { minM2 = Math.round(councilMinM2); basis = 'council'; }
  else if (BY_CODE[code]) minM2 = BY_CODE[code];
  else {
    const hit = BY_NAME.find(([re]) => re.test(name));
    minM2 = hit ? hit[1] : 600;
  }
  const known = !!(BY_CODE[code] || BY_NAME.some(([re]) => re.test(name)));
  let note = '';
  if (basis === 'default' && !known) note = 'No zone was found for this lot, so a general figure is used.';
  else if (basis === 'default' && minM2 >= 100000) note = 'Rural zones usually carry a large minimum lot size set by the council LEP lot size map.';
  else if (basis === 'default' && (code === 'R5' || code === 'LLR' || /rural residential/i.test(name))) note = 'Large lot zones carry a minimum set by the council LEP lot size map.';
  return {
    minM2, minFrontM: frontageFor(minM2), basis, basisText: BASIS_TEXT[basis],
    zoneCode: code, zoneName: name, zoneKind: kind, note,
  };
}

/** "5 to 7 lots", "about 3 lots", or a plain no-subdivision line. */
export function rangeText(low, high) {
  if (!(high >= 2)) return 'No further subdivision indicated';
  if (low >= high) return `About ${high} lots`;
  if (low <= 1) return `Up to about ${high} lots`;
  return `About ${low} to ${high} lots`;
}
