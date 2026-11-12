// Data for the cover locality plan: a real aerial of the site and the cadastre well beyond the lot.
//
//   exportPlanSet({ ..., aerial, fetchSite })
//
// `aerial` (optional): { image, extent | extentM, attribution?, state? }
//     image   a data URL (PNG or JPEG), a Uint8Array, an ArrayBuffer or a Blob
//     extent  { x0, y0, x1, y1 } in the lot's plan millimetres (y down, up = grid north), the picture's outer edges
//     extentM { minE, minN, maxE, maxN } the same in metres in the lot's frame (x east, y north), for the metre form of the lot
// `fetchSite` (optional): async ({ lot, request }) => { aerial?, lot?: { neighbours, roads } } | null, called when no usable aerial is in
//     the call or on the lot. `request` is localityRequest(lot): the aerial parameters for GET /api/site/aerial and `radius` for
//     GET /api/site/lot. `lot.neighbours` and `lot.roads` are in plan mm (the schema 2 form) and replace the lot's own.
// With neither, a browser export asks /api/site/aerial and /api/site/lot?radius= itself when the lot has a georeference (origin, srid).
// Nothing here ever invents imagery: when there is none the sheet says so.

import { planToMga, mgaToLonLat, siteToPlan, zoneForSrid } from '../../../site/geo.js';

export const LOCALITY_MIN_M = 250; // ground shown beyond the lot on each side, at least
export const LOCALITY_MAX_M = 450;
export const LOCALITY_PX = 2048;
export const LOCALITY_RADIUS_M = 300; // the largest the server allows for /api/site/lot radius

const snap = (v, f, up) => (up ? Math.ceil(v / f) : Math.floor(v / f)) * f;

/**
 * What to ask the site service for: an aerial about 400 to 900 m square around the lot (the service returns JPEG, 2048 px at most) and the cadastre within
 * `radius` metres. Returns null when the lot has no MGA georeference (origin and srid).
 */
export function localityRequest(lot) {
  if (!lot?.origin || !Number.isFinite(lot.origin.e) || !(lot.boundary?.length >= 3)) return null;
  const xs = lot.boundary.map((p) => p.x);
  const ys = lot.boundary.map((p) => p.y);
  const lo = planToMga(lot.origin, { x: Math.min(...xs), y: Math.max(...ys) });
  const hi = planToMga(lot.origin, { x: Math.max(...xs), y: Math.min(...ys) });
  const cE = (lo.e + hi.e) / 2;
  const cN = (lo.n + hi.n) / 2;
  const span = Math.max(hi.e - lo.e, hi.n - lo.n);
  const half = snap(Math.min(LOCALITY_MAX_M, Math.max(LOCALITY_MIN_M, span / 2 + 200)), 50, true);
  const box = { minE: snap(cE - half, 50, false), minN: snap(cN - half, 50, false), maxE: snap(cE + half, 50, true), maxN: snap(cN + half, 50, true) };
  const side = Math.max(box.maxE - box.minE, box.maxN - box.minN);
  const res = Math.min(2, Math.max(0.1, side / LOCALITY_PX));
  return {
    state: lot.state || '',
    srid: lot.srid || '',
    origin: `${lot.origin.e},${lot.origin.n}`,
    bbox: box,
    radius: LOCALITY_RADIUS_M,
    aerialParams: {
      ...(lot.state ? { state: lot.state } : {}),
      ...(lot.srid ? { srid: String(lot.srid) } : {}),
      origin: `${lot.origin.e},${lot.origin.n}`,
      bbox: `${box.minE},${box.minN},${box.maxE},${box.maxN}`,
      res: res.toFixed(3),
      maxpx: String(LOCALITY_PX),
    },
  };
}

const sniff = (u8) => (u8[0] === 0x89 && u8[1] === 0x50 ? 'PNG' : 'JPEG');

/** An image in any accepted form as { data, format } for jsPDF.addImage, or null. */
export async function normaliseImage(image) {
  try {
    if (!image) return null;
    if (typeof image === 'string') {
      const m = /^data:image\/(png|jpe?g)/i.exec(image);
      return m ? { data: image, format: m[1].toLowerCase() === 'png' ? 'PNG' : 'JPEG' } : null;
    }
    let u8 = null;
    if (image instanceof Uint8Array) u8 = image;
    else if (image instanceof ArrayBuffer) u8 = new Uint8Array(image);
    else if (typeof image.arrayBuffer === 'function') u8 = new Uint8Array(await image.arrayBuffer());
    return u8 && u8.length > 100 ? { data: u8, format: sniff(u8) } : null;
  } catch {
    return null;
  }
}

const extentOf = (a) => {
  if (a?.extent && [a.extent.x0, a.extent.y0, a.extent.x1, a.extent.y1].every(Number.isFinite)) return a.extent;
  const m = a?.extentM;
  if (m && [m.minE, m.minN, m.maxE, m.maxN].every(Number.isFinite)) return { x0: m.minE * 1000, y0: -m.maxN * 1000, x1: m.maxE * 1000, y1: -m.minN * 1000 };
  return null;
};

async function prepAerial(a) {
  const ext = extentOf(a);
  const img = ext && (await normaliseImage(a.image));
  if (!ext || !img || !(ext.x1 > ext.x0) || !(ext.y1 > ext.y0)) return null;
  return { ...img, extent: ext, attribution: String(a.attribution || ''), state: a.state || '' };
}

/** Fraction of the view (plan mm rectangle) the aerial covers, 0 to 1. */
export function coverage(aerial, view) {
  if (!aerial) return 0;
  const e = aerial.extent;
  const w = Math.max(0, Math.min(e.x1, view.x1) - Math.max(e.x0, view.x0));
  const h = Math.max(0, Math.min(e.y1, view.y1) - Math.max(e.y0, view.y0));
  return (w * h) / ((view.x1 - view.x0) * (view.y1 - view.y0));
}

/** The cadastre from a /api/site/lot response as plan mm, relative to the stored lot's origin. */
export function neighboursFromResponse(resp, origin) {
  const dx = resp.origin && origin ? resp.origin.e - origin.e : 0;
  const dy = resp.origin && origin ? resp.origin.n - origin.n : 0;
  const ring = (r) => (r || []).map((p) => siteToPlan([p[0] + dx, p[1] + dy]));
  return {
    neighbours: (resp.neighbours || []).map((n, i) => ({ id: `n_${i}`, lotNumber: n.lotNumber, planLabel: n.planLabel, areaM2: n.areaM2, isRoad: !!n.isRoad, ring: ring(n.polygons?.[0]?.outer) })),
    roads: (resp.roads || []).map((r) => ({ name: r.name || '', pts: (r.points || []).flatMap((p) => { const q = siteToPlan([p[0] + dx, p[1] + dy]); return [Math.round(q.x), Math.round(q.y)]; }) })),
  };
}

const blobToDataUrl = (blob) => new Promise((res) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result));
  r.onerror = () => res(null);
  r.readAsDataURL(blob);
});

/** Browser default: ask the site service for the wide aerial and the wider cadastre. Resolves to null when it cannot. */
export async function browserFetchSite({ lot, request }) {
  if (typeof window === 'undefined' || typeof fetch !== 'function' || !request || !lot.origin) return null;
  const needAerial = request.need?.aerial !== false;
  const { fetchAerial, getJson } = await import('../../../site/client.js');
  const { aerialExtentPlan } = await import('../../../site/model.js');
  const zone = zoneForSrid(Number(lot.srid));
  const out = {};
  await Promise.all([
    (async () => {
      try {
        if (!needAerial) return;
        const { blob, meta } = await fetchAerial(request.aerialParams, {});
        out.aerial = { image: await blobToDataUrl(blob), extent: aerialExtentPlan(meta.bbox, lot.origin), attribution: meta.attribution || '', state: lot.state };
      } catch { /* no aerial */ }
    })(),
    (async () => {
      try {
        if (!zone) return;
        const m = mgaToLonLat(lot.origin.e, lot.origin.n, zone);
        const resp = await getJson('lot', { lon: m.lon, lat: m.lat, ...(lot.state ? { state: lot.state } : {}), radius: request.radius }, {});
        out.lot = neighboursFromResponse(resp, lot.origin);
      } catch { /* the lot's own neighbours stay */ }
    })(),
  ]);
  return out.aerial || out.lot ? out : null;
}

/** The lot's own stored aerial (site.lot.aerialWide, then site.lot.aerial) read back through `loadImage(key)` (the browser's image store). */
async function storedAerial(lot, loadImage) {
  const get = loadImage || (typeof window !== 'undefined' ? async (k) => { const { loadImageBlob } = await import('../../../editor2d/underlay.js'); return loadImageBlob(k); } : null);
  if (!get) return [];
  const out = [];
  for (const a of [lot.aerialWide, lot.aerial]) {
    if (!a?.key || !a.extent) continue;
    try {
      const blob = await get(a.key);
      const img = blob && (typeof blob === 'string' ? blob : await blobToDataUrl(blob));
      const prepared = img && (await prepAerial({ image: img, extent: a.extent, attribution: lot.provenance?.aerial?.attribution || a.attribution || '', state: lot.state }));
      if (prepared) out.push(prepared);
    } catch { /* try the next one */ }
  }
  return out;
}

/**
 * Settles what the locality plan shows: { aerial | null, neighbours?, roads? }. Order: the aerial given, the lot's stored aerial when it
 * covers the view, the fetch hook (or the browser default), then whatever partial picture exists. `view` is the plan mm rectangle drawn.
 */
export async function resolveLocality({ lot, aerial = null, fetchSite = undefined, loadImage = null, view }) {
  const result = { aerial: null };
  const good = (a) => a && coverage(a, view) >= 0.8;
  const given = aerial ? await prepAerial(aerial) : null;
  const stored = given ? [] : await storedAerial(lot, loadImage);
  const have = [given, ...stored].find(good) || null;
  if (have) result.aerial = have;
  const hook = fetchSite === undefined ? browserFetchSite : fetchSite;
  // The hook always gets the chance to supply the wider cadastre; `need.aerial` says whether it should also fetch a picture.
  const base = localityRequest(lot);
  const request = base && { ...base, need: { aerial: !have, cadastre: true } };
  let got = null;
  if (typeof hook === 'function') {
    try { got = await hook({ lot, request }); } catch { got = null; }
  }
  if (got?.lot) {
    if (Array.isArray(got.lot.neighbours)) result.neighbours = got.lot.neighbours;
    if (Array.isArray(got.lot.roads)) result.roads = got.lot.roads;
  }
  if (!result.aerial && got?.aerial) {
    const a = await prepAerial(got.aerial);
    if (a) result.aerial = a;
  }
  if (!result.aerial) {
    const partial = [given, ...stored].filter(Boolean).sort((p, q) => coverage(q, view) - coverage(p, view))[0];
    if (partial && coverage(partial, view) > 0.05) result.aerial = partial;
  }
  return result;
}
