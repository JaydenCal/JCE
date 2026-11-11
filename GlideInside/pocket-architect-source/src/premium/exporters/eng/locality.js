// A wider aerial for the locality map and the key plan. The aerial stored with the lot covers only the lot and a 30 m margin, so a
// locality map at a sensible scale (and any rural lot) would show a small patch in a grey frame. This asks for the aerial over the
// extent the map needs. In the browser it uses the site service; options.fetchAerial({ project, lot, extent }) replaces it (tests, the
// sample generator, or a host with its own imagery). Returns { bytes, extent } with extent in plan mm, or null (the map then stays
// inside the aerial that exists).

import { planToMga, mgaToPlan } from '../../../site/geo.js';

const MAX_SIDE_M = 6000;

async function toBytes(src) {
  if (!src) return null;
  if (src instanceof Uint8Array) return src;
  if (src instanceof ArrayBuffer) return new Uint8Array(src);
  if (typeof Blob !== 'undefined' && src instanceof Blob) return new Uint8Array(await src.arrayBuffer());
  if (typeof src === 'string') {
    const m = /^data:image\/(?:png|jpe?g|webp);base64,(.*)$/s.exec(src);
    if (!m) return null;
    const bin = atob(m[1]);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return null;
}

/** True when `have` covers `need` (both plan mm rectangles) to within a small slack. */
export const covers = (have, need, slack = 0.02) => !!have && have.x0 <= need.x0 + (need.x1 - need.x0) * slack && have.y0 <= need.y0 + (need.y1 - need.y0) * slack && have.x1 >= need.x1 - (need.x1 - need.x0) * slack && have.y1 >= need.y1 - (need.y1 - need.y0) * slack;

export async function fetchWideAerial(project, extent, options = {}) {
  const lot = project?.site?.lot;
  if (!lot || !extent) return null;
  try {
    if (typeof options.fetchAerial === 'function') {
      const r = await options.fetchAerial({ project, lot, extent });
      const bytes = r ? await toBytes(r.bytes || r.url || r.blob) : null;
      return bytes && r.extent ? { bytes, extent: r.extent, neighbours: r.neighbours || null, roads: r.roads || null } : null;
    }
    if (options.wideAerial === false || typeof window === 'undefined' || typeof fetch !== 'function' || !lot.state || !lot.srid) return null;
    const { CONFIG } = await import('../../../config.js');
    if (CONFIG.siteMock) return null;
    const a = planToMga(lot.origin, { x: extent.x0, y: extent.y0 });
    const b = planToMga(lot.origin, { x: extent.x1, y: extent.y1 });
    const box = { minE: Math.min(a.e, b.e), maxE: Math.max(a.e, b.e), minN: Math.min(a.n, b.n), maxN: Math.max(a.n, b.n) };
    if (box.maxE - box.minE > MAX_SIDE_M || box.maxN - box.minN > MAX_SIDE_M) return null;
    const params = new URLSearchParams({ state: lot.state, srid: String(lot.srid), origin: `${lot.origin.e},${lot.origin.n}`, bbox: `${box.minE},${box.minN},${box.maxE},${box.maxN}`, res: String(Math.max(0.25, (box.maxE - box.minE) / 3600)) });
    const res = await fetch(`${String(CONFIG.apiBase || '/api').replace(/\/+$/, '')}/site/aerial?${params}`);
    if (!res.ok) return null;
    let meta = JSON.parse(decodeURIComponent(res.headers.get('x-site-meta') || '{}'));
    let blob = await res.blob();
    if (meta.georef && meta.georef !== 'mga') ({ blob, meta } = await (await import('../../../site/warp.js')).warpToMga(blob, meta));
    if (!meta.bbox) return null;
    const p0 = mgaToPlan(lot.origin, meta.bbox.minE, meta.bbox.maxN);
    const p1 = mgaToPlan(lot.origin, meta.bbox.maxE, meta.bbox.minN);
    return { bytes: new Uint8Array(await blob.arrayBuffer()), extent: { x0: p0.x, y0: p0.y, x1: p1.x, y1: p1.y }, meta };
  } catch {
    return null;
  }
}
