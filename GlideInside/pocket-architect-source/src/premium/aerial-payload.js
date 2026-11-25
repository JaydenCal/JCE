// The lot's aerial pictures for a server built PDF. The picture lives in this browser (IndexedDB, or memory when the browser blocks it) under the key in
// site.lot.aerial / site.lot.aerialWide, so the server cannot see it: without this the server plan set printed no aerial on any site sheet. The sharp tile
// comes first (it covers the site sheets), then the wide one (it covers the locality plan). Never fatal: any failure just sends fewer pictures.

import { blobToDataUrl } from './util.js';

const MAX_CHARS = 2_300_000; // a data URL longer than this is re-encoded smaller (the server drops anything over 2.6 million)

async function shrink(blob, maxSide = 1800) {
  try {
    if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return null;
    const bmp = await createImageBitmap(blob);
    const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k);
    c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const out = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.82));
    return out || null;
  } catch { return null; }
}

/**
 * [{ image (data URL), extent (plan mm), attribution }] for the project's lot, or null when there is none or "Include aerial underlay" is off.
 * `loadBlob(key)` reads the stored picture (the browser image store by default).
 */
export async function aerialPayload(project, { loadBlob = null } = {}) {
  const lot = project?.site?.lot;
  if (!lot || project?.drawing?.includeAerial === false) return null;
  const get = loadBlob || (async (k) => (await import('../editor2d/underlay.js')).loadImageBlob(k));
  const out = [];
  for (const a of [lot.aerial, lot.aerialWide]) {
    if (!a?.key || !a.extent) continue;
    try {
      let blob = await get(a.key);
      if (!blob) continue;
      let url = typeof blob === 'string' ? blob : await blobToDataUrl(blob);
      if (url && url.length > MAX_CHARS && typeof blob !== 'string') {
        const small = await shrink(blob);
        if (small) url = await blobToDataUrl(small);
      }
      if (url && url.length <= MAX_CHARS) out.push({ image: url, extent: a.extent, attribution: lot.provenance?.aerial?.attribution || a.attribution || '' });
    } catch { /* this picture is left out */ }
  }
  return out.length ? out : null;
}
