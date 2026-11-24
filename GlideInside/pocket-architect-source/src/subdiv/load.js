// Subdivision check: look up one lot and its aerial, nothing else (no contours, no wide ring, no overlays, no stored project).
// Uses the same lot and aerial lookups as Find my block (src/site/client.js) and the same lot builder (src/site/model.js).

import { getLot, fetchAerial, margin, innerAerialRes } from '../site/client.js';
import { buildSiteLot } from '../site/model.js';
import { smartSearch, NOT_FOUND_TEXT } from '../site/address-search.js';

/**
 * Metres of aerial to fetch beside the lot (east-west and north-south) so the picture fills the screen plan (4:3) and the PDF plan (192 by 150 mm)
 * with no empty bands. Mirrors viewFor in render.js (the lot with a margin, widened to the page shape). At least the usual margin, at most 400 m.
 */
export function aerialMargins(b) {
  const w = b.maxE - b.minE;
  const h = b.maxN - b.minN;
  const pad = Math.max(12, Math.max(w, h) * 0.22);
  let mE = margin();
  let mN = margin();
  for (const aspect of [192 / 150, 4 / 3]) {
    let vw = w + 2 * pad; let vh = h + 2 * pad;
    if (vw / vh < aspect) vw = vh * aspect; else vh = vw / aspect;
    mE = Math.max(mE, (vw - w) / 2 + 3);
    mN = Math.max(mN, (vh - h) / 2 + 3);
  }
  return { mE: Math.min(400, mE), mN: Math.min(400, mN) };
}

export const MAX_LOT_M2 = 2_000_000; // a lot this big is outside what a rough layout means

/** Look up the address text (or take a chosen suggestion). Returns { lot, bitmap, aerialBlob, warnings, pick }. Throws Error with a readable message. */
export async function loadLotForCheck({ text = '', pick: given = null, signal, onStep } = {}) {
  const q = String(text || '').trim();
  const pick = given && Number.isFinite(given.lon) && Number.isFinite(given.lat) ? given : (await smartSearch(q, { onRetry: () => onStep?.('busy'), signal }))[0];
  if (!pick) throw Object.assign(new Error(NOT_FOUND_TEXT), { notFound: true });
  onStep?.('lot');
  const res = await getLot({ lon: pick.lon, lat: pick.lat, ...(pick.state ? { state: pick.state } : {}) }, { signal, onRetry: () => onStep?.('busy') });
  if (!res?.lot?.polygons?.length) throw new Error('We could not find a lot boundary for that address.');
  const warnings = [];
  const b = res.lot.bboxMga;
  const { mE, mN } = aerialMargins(b);
  const m = Math.max(mE, mN);
  let aerial = null;
  onStep?.('aerial');
  try {
    aerial = await fetchAerial({ state: res.state, srid: res.srid, origin: `${res.origin.e},${res.origin.n}`, bbox: `${b.minE - mE},${b.minN - mN},${b.maxE + mE},${b.maxN + mN}`, res: innerAerialRes(b, m) }, { signal, timeoutMs: 25000 });
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    warnings.push('The aerial photo could not be loaded, so the layout is drawn on a plain background.');
  }
  const lot = buildSiteLot({
    lot: res, aerialMeta: aerial?.meta || null, aerialKey: aerial ? 'subdiv' : null,
    address: String(pick.label || '').replace(/\s*\(sample\)$/, ''), source: res.sample ? 'sample' : String(res.state || '').toLowerCase(), warnings,
  });
  let bitmap = null;
  if (aerial?.blob && typeof createImageBitmap === 'function') {
    try { bitmap = await createImageBitmap(aerial.blob); } catch { warnings.push('The aerial photo could not be read.'); }
  }
  return { lot, bitmap, warnings, pick };
}
