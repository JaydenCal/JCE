// Site lookup API: address search, lot (cadastre), aerial, contours, health. Web-standard fetch only, injectable fetchImpl.
//
//   GET /api/site/search?q=                          { results: [{ label, state, lon, lat }] }       up to 8, NSW and QLD
//   GET /api/site/lot?lon=&lat=&state=               the parcel at the point, neighbours within about 60 m, LGA, zone, road lines
//   GET /api/site/aerial?state=&srid=&bbox=          image bytes (JPEG) with georeference in the x-site-meta header (URL encoded JSON)
//   GET /api/site/contours?state=&srid=&bbox=&origin= elevation grid and contour lines (JSON)
//   GET /api/site/health                             probes every upstream service
//
// UPSTREAM SERVICES. Each line says what was confirmed by reading the service's ?f=json description on 11/11/2026 (WebFetch, because the build
// sandbox cannot reach the government hosts directly). "NOT CONFIRMED" means the query itself could not be run from the sandbox and has to be
// checked on the first live call (GET /api/site/health only proves the service answers, not that a query returns data).
//
//  NSW cadastre lots   https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Cadastre/MapServer/9   CONFIRMED layer "Lot", polygon, maxRecordCount 1000,
//                      fields lotnumber, sectionnumber, planlabel, planlotarea, lotidstring, stratumlevel, hasstratum. Layer SR 102100.
//                      NOT CONFIRMED: outSR=7854/7855/7856 and inSR=7844 accepted (the earlier JCE Python client used inSR/outSR 7844 on this layer).
//  NSW address points  https://portal.spatial.nsw.gov.au/server/rest/services/NSW_Geocoded_Addressing_Theme/FeatureServer/1 (AddressPoint) CONFIRMED LIVE 11/11/2026:
//                      fields address, housenumber, urbanity; address is UPPER CASE ("756 QUIA ROAD GUNNEDAH", "2/454 PEEL STREET TAMWORTH"). address LIKE 'q%'
//                      answers in about 100 ms, address LIKE '%WORD%' per word in about 600 ms; returnGeometry with outSR=4326 gives x/y as lon/lat.
//                      (NSW_Property/MapServer layers 1 to 4 reject attribute-only queries live, so they are no longer used for search.)
//  NSW LGA             .../public/NSW_Administrative_Boundaries/MapServer/1  CONFIRMED layer LocalGovernmentArea, field lganame.
//  NSW zoning          https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/Planning/EPI_Primary_Planning_Layers/MapServer/2  CONFIRMED "Land Zoning",
//                      fields SYM_CODE, LAY_CLASS, EPI_NAME, LGA_NAME.
//  NSW roads           https://portal.spatial.nsw.gov.au/server/rest/services/NSW_Transport_Theme/MapServer/5  CONFIRMED RoadSegment, polyline, fields roadnamebase, roadnametype.
//  NSW imagery         https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Imagery/MapServer  CONFIRMED SR 102100, max 4096 x 4096, JPG and PNG, copyright
//                      "(c) Department of Customer Service 2020". NOT CONFIRMED: /export in an MGA imageSR (a web mercator fallback is built in).
//  NSW imagery dates   .../public/NSW_Imagery_Dates/MapServer/0  CONFIRMED BestImageryDates, fields BlockStartDate, Resolution_cm.
//  NSW 5 m DEM         .../public/NSW_5M_Elevation/ImageServer  CONFIRMED F32, SR 102100, 5 m pixels, max 15000 x 4100, Image capability, orthometric heights,
//                      copyright "DFSI 2019". NOT CONFIRMED: exportImage format=tiff output (the earlier client read it with PIL and it worked, 30 to 60 s for big areas).
//  QLD parcels         https://spatial-gis.information.qld.gov.au/arcgis/rest/services/PlanningCadastre/LandParcelPropertyFramework/MapServer/4  CONFIRMED "Cadastral
//                      parcels", polygon, maxRecordCount 4000, fields lot, plan, lotplan, lot_area, tenure, parcel_typ, locality, shire_name. NOT CONFIRMED: queries.
//  QLD addresses       same MapServer layer 0 "Addresses" CONFIRMED (point, fields address, street_full, locality, latitude, longitude, lotplan). Used for search.
//                      No separate GeocodeServer was found: the LocationsAndAddresses folder needs a token (code 499), so layer 0 is used instead.
//  QLD LGA             same MapServer layer 20 "Local Government Areas" CONFIRMED, field lga.
//  QLD imagery         https://spatial-img.information.qld.gov.au/arcgis/rest/services/Basemaps/LatestStateProgram_AllUsers/ImageServer  CONFIRMED U8 x 3,
//                      SR 102100, max 4096 x 2048, Catalog capability. LICENCE: includes Planet satellite fill that is not open, so only aerial three years or
//                      older is used (see openAerialItems). NOT CONFIRMED: catalog item field names beyond those in the earlier client (name, capturestart, captureend).
//  QLD DEM             https://spatial-img.information.qld.gov.au/arcgis/rest/services/Elevation/QldDem/ImageServer  CONFIRMED F32, SR 102100, 0.5 m pixels, max 4096 x 2048.
//  QLD LiDAR extents   https://spatial-gis.information.qld.gov.au/arcgis/rest/services/Elevation/ElevationProjectExtents/MapServer/100  CONFIRMED "LiDAR tile footprints",
//                      fields tile_name, project_name, start_date, end_date, geotif_dem, horiz_acc, vert_acc.
//
// RASTER FORMAT. exportImage is asked for format=tiff, pixelType=F32, noData=-9999, in web mercator (the services' native grid) and read with the TIFF
// reader in src/site/tiff.js (uncompressed, LZW or Deflate, strips or tiles, with predictors). LERC needs a codec, and getSamples was far too slow for grids.
// The cells are then re-sampled bilinearly onto an MGA grid here, so the elevation grid and contours are in MGA metres like everything else.
// Fallback if the TIFF cannot be decoded: the request fails with 502 and the app carries on without contours (no point-by-point fallback).

import { HttpError, json, clientIp } from './http.js';
import {
  mgaZoneForLon, mgaSrid, zoneForSrid, lonLatToMga, mgaToLonLat, lonLatToWeb, mgaBoxToWebBox,
  ringsToPolygons, polygonArea, ringCentroid, interiorPoint, bboxOf, formatPlan, formatLotLabel, round, mgaToWeb,
} from '../../src/site/geo.js';
import { readTiff } from '../../src/site/tiff.js';
import { contourLines, fillGaps, gridRange } from '../../src/site/contours.js';

export const SERVICES = {
  nswLot: 'https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Cadastre/MapServer/9',
  nswProperty: 'https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Property/MapServer', // no longer used for search (its layers reject attribute queries); health probe only
  nswAddresses: 'https://portal.spatial.nsw.gov.au/server/rest/services/NSW_Geocoded_Addressing_Theme/FeatureServer/1',
  nswLga: 'https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Administrative_Boundaries/MapServer/1',
  nswZoning: 'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/Planning/EPI_Primary_Planning_Layers/MapServer/2',
  nswRoads: 'https://portal.spatial.nsw.gov.au/server/rest/services/NSW_Transport_Theme/MapServer/5',
  nswImagery: 'https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Imagery/MapServer',
  nswImageryDates: 'https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Imagery_Dates/MapServer/0',
  nswDem: 'https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_5M_Elevation/ImageServer',
  qldRoot: 'https://spatial-gis.information.qld.gov.au/arcgis/rest/services/PlanningCadastre/LandParcelPropertyFramework/MapServer',
  qldLot: 'https://spatial-gis.information.qld.gov.au/arcgis/rest/services/PlanningCadastre/LandParcelPropertyFramework/MapServer/4',
  qldAddresses: 'https://spatial-gis.information.qld.gov.au/arcgis/rest/services/PlanningCadastre/LandParcelPropertyFramework/MapServer/0',
  qldLga: 'https://spatial-gis.information.qld.gov.au/arcgis/rest/services/PlanningCadastre/LandParcelPropertyFramework/MapServer/20',
  qldImagery: 'https://spatial-img.information.qld.gov.au/arcgis/rest/services/Basemaps/LatestStateProgram_AllUsers/ImageServer',
  qldDem: 'https://spatial-img.information.qld.gov.au/arcgis/rest/services/Elevation/QldDem/ImageServer',
  qldLidar: 'https://spatial-gis.information.qld.gov.au/arcgis/rest/services/Elevation/ElevationProjectExtents/MapServer/100',
};

const TTL = { search: 86400, lot: 7 * 86400, aerial: 7 * 86400, contours: 7 * 86400, health: 60 };
const LIMITS = { search: [60, 60], lot: [20, 60], aerial: [20, 60], contours: [12, 60], health: [10, 60] }; // [hits, window seconds] per IP
const DAY_LIMIT = 800;
const NEIGHBOUR_M = 60;
const NEIGHBOUR_MAX_M = 400;

/** Neighbour search distance in metres: the request's neighbourM (0 to 400) or, when absent, max(60, 15 percent of the lot's bounding box diagonal) capped at 400. */
export function neighbourDistance(requested, diagonalM) {
  if (requested !== null && requested !== undefined && requested !== '' && Number.isFinite(Number(requested))) return Math.min(NEIGHBOUR_MAX_M, Math.max(0, Number(requested)));
  return Math.min(NEIGHBOUR_MAX_M, Math.max(NEIGHBOUR_M, Math.round(0.15 * (Number.isFinite(diagonalM) ? diagonalM : 0))));
}
const MAX_SPAN_M = 2000;
const NODATA = -9999;
const UA = 'PlanStudio-SiteLookup/1.0';

const NSW_CADASTRE_ATTR = 'Spatial Services, NSW Department of Customer Service (cadastre), CC BY 3.0 AU';
const QLD_CADASTRE_ATTR = 'State of Queensland (Department of Resources), cadastral parcels, CC BY 4.0';

const num = (v, name) => {
  const n = Number(v);
  if (v === null || v === undefined || v === '' || !Number.isFinite(n)) throw new HttpError('BAD_REQUEST', `${name} is missing or not a number.`);
  return n;
};
const sqlText = (s) => String(s).replace(/'/g, "''");
const pad2 = (n) => String(n).padStart(2, '0');
const ddmmyyyy = (ms) => {
  const d = new Date(ms);
  return `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
};
const titleCase = (s) => String(s || '').toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

const ABBREV = { ST: 'STREET', RD: 'ROAD', AVE: 'AVENUE', AV: 'AVENUE', DR: 'DRIVE', CRES: 'CRESCENT', PL: 'PLACE', CT: 'COURT', LN: 'LANE', HWY: 'HIGHWAY', PDE: 'PARADE', TCE: 'TERRACE' };

/** Search words: upper case, state names and a trailing postcode dropped, street type abbreviations expanded ("St" stays when it starts the address or follows a number, as in "5 St Johns Rd"). */
export function searchWords(tokens, state) {
  const drop = new Set(['AUSTRALIA', state === 'QLD' ? 'QUEENSLAND' : 'NEW', state === 'QLD' ? 'QLD' : 'NSW', ...(state ? [] : ['QLD', 'NSW', 'QUEENSLAND'])]);
  let t = tokens.filter((x) => !drop.has(x));
  if (t.length >= 3 && /^\d{4}$/.test(t[t.length - 1])) t = t.slice(0, -1);
  return t.map((x, i) => (ABBREV[x] && !(x === 'ST' && (i === 0 || /^\d/.test(t[i - 1]))) ? ABBREV[x] : x)).filter(Boolean);
}

/**
 * The state a search clearly names: 'NSW' or 'QLD', else null (query both). Looks for the state name or code and a trailing postcode
 * (NSW 2000 to 2599, 2619 to 2899, 2921 to 2999; QLD 4000 to 4999 and 9000 to 9999). Pure.
 */
export function inferState(tokens) {
  const t = tokens.map((x) => String(x).toUpperCase());
  const qld = t.includes('QLD') || t.includes('QUEENSLAND');
  const nsw = t.includes('NSW') || (t.includes('NEW') && t.includes('WALES'));
  if (qld && !nsw) return 'QLD';
  if (nsw && !qld) return 'NSW';
  if (qld || nsw) return null;
  const pc = t.length >= 3 && /^\d{4}$/.test(t[t.length - 1]) ? Number(t[t.length - 1]) : null;
  if (pc != null) {
    if ((pc >= 4000 && pc <= 4999) || (pc >= 9000 && pc <= 9999)) return 'QLD';
    if ((pc >= 2000 && pc <= 2599) || (pc >= 2619 && pc <= 2899) || (pc >= 2921 && pc <= 2999)) return 'NSW';
  }
  return null;
}

/** NSW AddressPoint where clauses: { prefix, words } or null. */
export function buildNswWhere(tokens) {
  const w = searchWords(tokens, 'NSW');
  if (!w.length) return null;
  const prefix = `address LIKE '${sqlText(w.join(' '))}%'`;
  const words = w.map((x) => `address LIKE '%${sqlText(x)}%'`).join(' AND ');
  return { prefix, words };
}

/** QLD Addresses where clause (mixed case address, so UPPER()), or null. */
export function buildQldWhere(tokens) {
  const w = searchWords(tokens, 'QLD');
  if (!w.length) return null;
  return w.map((t) => (/^\d+[A-Z]?$/.test(t) ? `(UPPER(address) LIKE '${sqlText(t)} %' OR UPPER(address) LIKE '% ${sqlText(t)} %' OR UPPER(address) LIKE '%/${sqlText(t)} %')` : `UPPER(address) LIKE '%${sqlText(t)}%'`)).join(' AND ');
}

export function parseBbox(text) {
  const p = String(text || '').split(',').map(Number);
  if (p.length !== 4 || p.some((v) => !Number.isFinite(v))) throw new HttpError('BAD_REQUEST', 'bbox must be minE,minN,maxE,maxN in metres.');
  const [minE, minN, maxE, maxN] = p;
  if (!(maxE > minE) || !(maxN > minN)) throw new HttpError('BAD_REQUEST', 'bbox is empty.');
  if (maxE - minE > MAX_SPAN_M || maxN - minN > MAX_SPAN_M) throw new HttpError('BAD_REQUEST', `That area is larger than ${MAX_SPAN_M} m. Site lookup is for single lots.`);
  return { minE, minN, maxE, maxN };
}

function srsFor(url) {
  const zoneParam = url.searchParams.get('srid');
  const srid = Number(zoneParam);
  const zone = zoneForSrid(srid);
  if (!zone) throw new HttpError('BAD_REQUEST', 'srid must be 7854, 7855 or 7856 (GDA2020 / MGA zone 54 to 56).');
  return { srid: 7800 + zone, zone };
}

function stateParam(url, { required = false } = {}) {
  const s = (url.searchParams.get('state') || '').toUpperCase();
  if (!s) {
    if (required) throw new HttpError('BAD_REQUEST', 'state must be NSW or QLD.');
    return null;
  }
  if (s !== 'NSW' && s !== 'QLD') throw new HttpError('UNSUPPORTED_AREA', 'Site lookup covers NSW and Queensland only.');
  return s;
}

// A Cache API wrapper (Workers) with an in-memory fallback. Values are Response-like { body: ArrayBuffer | string, headers }.
export function createCache({ now = () => Date.now(), max = 200 } = {}) {
  const mem = new Map();
  const api = typeof caches !== 'undefined' && caches?.default ? caches.default : null;
  const keyUrl = (key) => `https://site-cache.invalid/${encodeURIComponent(key)}`;
  return {
    async get(key) {
      const hit = mem.get(key);
      if (hit && hit.expires > now()) return hit.value;
      if (hit) mem.delete(key);
      if (api) {
        try {
          const res = await api.match(keyUrl(key));
          if (res) return { body: await res.arrayBuffer(), headers: Object.fromEntries(res.headers) };
        } catch {
          /* cache unavailable */
        }
      }
      return null;
    },
    async put(key, value, ttlSec) {
      mem.set(key, { value, expires: now() + ttlSec * 1000 });
      if (mem.size > max) mem.delete(mem.keys().next().value);
      if (api) {
        try {
          await api.put(keyUrl(key), new Response(value.body, { headers: { ...value.headers, 'cache-control': `public, max-age=${ttlSec}` } }));
        } catch {
          /* cache unavailable */
        }
      }
    },
  };
}

export function createSite({ store = null, fetchImpl, now = () => Date.now(), cache = null } = {}) {
  const doFetch = fetchImpl || ((...a) => globalThis.fetch(...a));
  const bytesCache = cache || createCache({ now });
  const iso = () => new Date(now()).toISOString();

  // Upstream calls ----------------------------------------------------------------------------------------------------------------
  async function upstream(url, params, { as = 'json', timeoutMs = 25000, retries = 1, post = false } = {}) {
    const full = params && !post ? `${url}?${new URLSearchParams(params)}` : url;
    let last = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await doFetch(full, { ...(post ? { method: 'POST', body: new URLSearchParams(params).toString() } : {}), headers: { 'user-agent': UA, accept: as === 'json' ? 'application/json' : '*/*', ...(post ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) }, signal: typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(timeoutMs) : undefined });
        if (!res.ok) {
          last = new Error(`HTTP ${res.status}`);
          if (res.status < 500 && res.status !== 429) break;
          continue;
        }
        if (as === 'bytes') {
          const type = res.headers.get('content-type') || '';
          const bytes = new Uint8Array(await res.arrayBuffer());
          if (/json|text/i.test(type)) {
            // ArcGIS reports many failures as HTTP 200 with a JSON or text body: keep the message for the log and treat it as a failure.
            last = new Error(`HTTP ${res.status} ${type.split(';')[0]}: ${new TextDecoder().decode(bytes.subarray(0, 300))}`);
            break;
          }
          return { bytes, type };
        }
        const body = await res.json();
        if (body?.error) {
          const code = body.error.code;
          last = new Error(`service error ${code}: ${body.error.message || ''}`);
          if ([500, 502, 503, 504, 429].includes(code)) continue;
          break;
        }
        return body;
      } catch (e) {
        last = e;
      }
    }
    console.warn(`[site] upstream failed ${url}${params && !post ? `?${new URLSearchParams(params)}` : ''}: ${String(last?.message || last).slice(0, 300)}`);
    throw new HttpError('SITE_UPSTREAM', 'A government map service did not answer. Try again soon, or keep drawing without a lot.', { detail: String(last?.message || last).slice(0, 200) });
  }

  async function rateLimit(request, kind) {
    if (!store?.hitRate) return;
    const ip = clientIp(request);
    const [max, win] = LIMITS[kind];
    const nowMs = now();
    const n = await store.hitRate(`site:${kind}:${ip}`, win, nowMs);
    if (n > max) throw new HttpError('RATE_LIMITED', 'Too many lookups. Wait a minute and try again.', { retryAfter: win });
    const day = await store.hitRate(`site:day:${ip}`, 86400, nowMs);
    if (day > DAY_LIMIT) throw new HttpError('RATE_LIMITED', 'Daily lookup limit reached. Try again tomorrow.', { retryAfter: 3600 });
  }

  // JSON results cached in the store (D1 table site_cache) so they survive Worker restarts and are shared by all Workers.
  async function jsonCached(key, ttl, compute, { ttlFor = null } = {}) {
    const nowMs = now();
    if (store?.getSiteCache) {
      try {
        const hit = await store.getSiteCache(key, nowMs);
        if (hit) return { value: JSON.parse(hit), cached: true };
      } catch {
        /* a cache failure never fails the request */
      }
    }
    const value = await compute();
    if (store?.putSiteCache) {
      try {
        const t = ttlFor ? ttlFor(value, ttl) : ttl;
        if (t > 0) await store.putSiteCache(key, JSON.stringify(value), t, nowMs);
      } catch {
        /* ignore */
      }
    }
    return { value, cached: false };
  }

  // Search --------------------------------------------------------------------------------------------------------------------------
  function searchTokens(q) {
    return q.toUpperCase().replace(/[,.]/g, ' ').replace(/[^A-Z0-9'/\- ]/g, ' ').split(/\s+/).filter(Boolean);
  }

  // Each upstream gets 2.5 s and no retry: whatever has arrived by then is returned (a slow service must not hold the dropdown back).
  const SEARCH_TIMEOUT_MS = 2500;
  async function searchNsw(tokens, st) {
    const w = buildNswWhere(tokens);
    if (!w) return [];
    const run = (where) => upstream(`${SERVICES.nswAddresses}/query`, {
      f: 'json', where, outFields: 'address', returnGeometry: 'true', outSR: '4326', resultRecordCount: '8',
    }, { timeoutMs: SEARCH_TIMEOUT_MS, retries: 0 }).catch(() => { st.partial = true; return { features: [] }; });
    // The prefix query (index friendly) and the every-word query run together; the prefix result wins when it found anything.
    const [pre, any] = await Promise.all([run(w.prefix), w.words !== w.prefix ? run(w.words) : Promise.resolve({ features: [] })]);
    const body = (pre.features || []).length ? pre : any;
    return (body.features || []).filter((f) => f.geometry && Number.isFinite(f.geometry.x) && f.attributes?.address).map((f) => ({
      label: `${titleCase(f.attributes.address)} NSW`, state: 'NSW', lon: round(f.geometry.x, 6), lat: round(f.geometry.y, 6),
    }));
  }

  async function searchQld(tokens, st) {
    const where = buildQldWhere(tokens);
    if (!where) return [];
    const body = await upstream(`${SERVICES.qldAddresses}/query`, {
      f: 'json', where, outFields: 'address,locality', returnGeometry: 'true', outSR: '7844', resultRecordCount: '8',
    }, { timeoutMs: SEARCH_TIMEOUT_MS, retries: 0 }).catch(() => { st.partial = true; return { features: [] }; });
    return (body.features || []).filter((f) => f.geometry && f.attributes?.address).map((f) => ({
      label: /\bQLD\b/i.test(f.attributes.address) ? titleCase(f.attributes.address).replace(/\bQld\b/, 'QLD') : `${titleCase(f.attributes.address)} QLD`,
      state: 'QLD', lon: round(f.geometry.x, 6), lat: round(f.geometry.y, 6),
    }));
  }

  async function search(request, url) {
    await rateLimit(request, 'search');
    const q = (url.searchParams.get('q') || '').trim();
    if (q.length < 3) return json({ results: [] });
    if (q.length > 120) throw new HttpError('BAD_REQUEST', 'q is too long.');
    const tokens = searchTokens(q);
    const only = inferState(tokens);
    const wantNsw = only !== 'QLD';
    const wantQld = only !== 'NSW';
    const key = `search:${tokens.join(' ')}`;
    // Workers Cache API (1 day) in front of the store cache; a partial answer (an upstream timed out) is never cached.
    const edge = typeof caches !== 'undefined' && caches?.default ? caches.default : null;
    const edgeUrl = `https://site-cache.invalid/${encodeURIComponent(key)}`;
    if (edge) {
      try {
        const hit = await edge.match(edgeUrl);
        if (hit) return json(await hit.json(), 200, { 'cache-control': 'public, max-age=300', 'x-search-cache': 'edge' });
      } catch {
        /* cache unavailable */
      }
    }
    const st = { partial: false };
    const { value } = await jsonCached(key, TTL.search, async () => {
      const [a, b] = await Promise.all([wantNsw ? searchNsw(tokens, st) : [], wantQld ? searchQld(tokens, st) : []]);
      // Interleave so both states show, shortest label first inside each (closest to what was typed).
      const byLen = (x, y) => x.label.length - y.label.length || x.label.localeCompare(y.label);
      a.sort(byLen);
      b.sort(byLen);
      const seen = new Set();
      const merged = [];
      for (let i = 0; merged.length < 8 && (i < a.length || i < b.length); i++) {
        for (const r of [a[i], b[i]]) {
          if (r && !seen.has(r.label)) {
            seen.add(r.label);
            merged.push(r);
          }
        }
      }
      return { results: merged.slice(0, 8) };
    }, { ttlFor: (v, ttl) => (st.partial || !v.results.length ? 0 : ttl) });
    if (edge && !st.partial && value.results.length) {
      try { await edge.put(edgeUrl, new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${TTL.search}` } })); } catch { /* ignore */ }
    }
    return json(value, 200, { 'cache-control': 'public, max-age=300' });
  }

  // Lot ----------------------------------------------------------------------------------------------------------------------------
  const point = (lon, lat) => ({ geometry: `${lon},${lat}`, geometryType: 'esriGeometryPoint', inSR: '7844', spatialRel: 'esriSpatialRelIntersects' });
  const envelope = (b, srid) => ({
    geometry: JSON.stringify({ xmin: b.minE, ymin: b.minN, xmax: b.maxE, ymax: b.maxN, spatialReference: { wkid: srid } }),
    geometryType: 'esriGeometryEnvelope', inSR: String(srid), spatialRel: 'esriSpatialRelIntersects',
  });

  function parcelOf(state, f) {
    const a = f.attributes || {};
    const polys = ringsToPolygons(f.geometry?.rings || []);
    if (!polys.length) return null;
    polys.sort((x, y) => polygonArea(y) - polygonArea(x)); // every part of a multipart lot kept, the largest first
    if (state === 'NSW') {
      const lotNumber = String(a.lotnumber ?? '').trim();
      const section = String(a.sectionnumber ?? '').trim();
      const planLabel = formatPlan(a.planlabel);
      return { id: a.lotidstring || `${lotNumber}/${section}/${planLabel}`, lotNumber, section, planLabel, registered: Number(a.planlotarea) || null, lotPlan: a.lotidstring || '', isRoad: false, polys };
    }
    const lotNumber = String(a.lot ?? '').trim();
    const planLabel = formatPlan(a.plan);
    const road = /road/i.test(String(a.tenure || '')) || /road/i.test(String(a.parcel_typ || ''));
    return { id: a.lotplan || `${lotNumber}${planLabel}`, lotNumber, section: '', planLabel, registered: Number(a.lot_area) || null, lotPlan: a.lotplan || '', isRoad: road, polys, locality: a.locality, shire: a.shire_name };
  }

  async function lookupLotIn(state, lon, lat, srid) {
    const layer = state === 'NSW' ? SERVICES.nswLot : SERVICES.qldLot;
    const fields = state === 'NSW' ? 'lotnumber,sectionnumber,planlabel,planlotarea,lotidstring,stratumlevel,hasstratum' : 'lot,plan,lotplan,lot_area,tenure,parcel_typ,locality,shire_name';
    const body = await upstream(`${layer}/query`, { f: 'json', ...point(lon, lat), outFields: fields, returnGeometry: 'true', outSR: String(srid) });
    const parcels = (body.features || []).map((f) => parcelOf(state, f)).filter(Boolean).filter((p) => !p.isRoad);
    if (!parcels.length) return null;
    // Strata and volumetric lots stack on one footprint: take the largest parcel at the point (the parent lot).
    const area = (p) => p.polys.reduce((s, q) => s + polygonArea(q), 0);
    return parcels.reduce((a, b) => (area(b) > area(a) ? b : a));
  }

  const toRel = (ring, o) => ring.map(([e, n]) => [round(e - o.e, 3), round(n - o.n, 3)]);
  const polysRel = (polys, o) => polys.map((p) => ({ outer: toRel(p.outer, o), holes: p.holes.map((h) => toRel(h, o)) }));

  async function lot(request, url) {
    await rateLimit(request, 'lot');
    const lon = num(url.searchParams.get('lon'), 'lon');
    const lat = num(url.searchParams.get('lat'), 'lat');
    let zone;
    try {
      zone = mgaZoneForLon(lon);
    } catch {
      throw new HttpError('UNSUPPORTED_AREA', 'That location is outside NSW and Queensland. Site lookup only covers those two states.');
    }
    if (lat > -9 || lat < -38) throw new HttpError('UNSUPPORTED_AREA', 'That location is outside NSW and Queensland. Site lookup only covers those two states.');
    const wanted = stateParam(url);
    const srid = mgaSrid(zone);
    const neighbourParam = url.searchParams.get('neighbourM');
    if (neighbourParam !== null && neighbourParam !== '' && !Number.isFinite(Number(neighbourParam))) throw new HttpError('BAD_REQUEST', 'neighbourM must be a number of metres.');
    const nbKey = neighbourParam === null || neighbourParam === '' ? 'auto' : String(Math.min(NEIGHBOUR_MAX_M, Math.max(0, Math.round(Number(neighbourParam)))));
    const { value } = await jsonCached(`lot3:${wanted || 'auto'}:${round(lon, 5)}:${round(lat, 5)}:${nbKey}`, TTL.lot, async () => {
      const order = wanted ? [wanted] : lat < -29 ? ['NSW', 'QLD'] : ['QLD', 'NSW'];
      let state = null;
      let parcel = null;
      for (const s of order) {
        parcel = await lookupLotIn(s, lon, lat, srid);
        if (parcel) {
          state = s;
          break;
        }
      }
      if (!parcel) throw new HttpError('NOT_FOUND', 'No lot was found at that address.');
      // One parcel supplies the area, label, outline and origin. A multipart lot keeps every part (largest first); the area is their sum.
      const parts = parcel.polys.filter((q) => polygonArea(q) > 0.5);
      const biggest = parts[0] || parcel.polys[0];
      const allBoxes = (parts.length ? parts : [biggest]).map((q) => bboxOf(q.outer));
      const lotBboxAll = { minX: Math.min(...allBoxes.map((q) => q.minX)), minY: Math.min(...allBoxes.map((q) => q.minY)), maxX: Math.max(...allBoxes.map((q) => q.maxX)), maxY: Math.max(...allBoxes.map((q) => q.maxY)) };
      const c = ringCentroid(biggest.outer);
      // A concave lot can have its centroid outside: keep the centroid as the origin anyway (it is only a reference) but report it.
      const origin = { e: round(c[0], 3), n: round(c[1], 3) };
      const lotBox = { minE: lotBboxAll.minX, minN: lotBboxAll.minY, maxE: lotBboxAll.maxX, maxN: lotBboxAll.maxY };
      const nbM = neighbourDistance(neighbourParam, Math.hypot(lotBox.maxE - lotBox.minE, lotBox.maxN - lotBox.minN));
      const around = { minE: lotBox.minE - nbM, minN: lotBox.minN - nbM, maxE: lotBox.maxE + nbM, maxN: lotBox.maxN + nbM };
      const layer = state === 'NSW' ? SERVICES.nswLot : SERVICES.qldLot;
      const fields = state === 'NSW' ? 'lotnumber,sectionnumber,planlabel,planlotarea,lotidstring,stratumlevel,hasstratum' : 'lot,plan,lotplan,lot_area,tenure,parcel_typ,locality,shire_name';
      const lgaCall = state === 'NSW'
        ? upstream(`${SERVICES.nswLga}/query`, { f: 'json', ...point(lon, lat), outFields: 'lganame', returnGeometry: 'false' }).then((b) => b.features?.[0]?.attributes?.lganame || '')
        : upstream(`${SERVICES.qldLga}/query`, { f: 'json', ...point(lon, lat), outFields: 'lga', returnGeometry: 'false' }).then((b) => b.features?.[0]?.attributes?.lga || '');
      const zoneCall = state === 'NSW'
        ? upstream(`${SERVICES.nswZoning}/query`, { f: 'json', ...point(lon, lat), outFields: 'SYM_CODE,LAY_CLASS,EPI_NAME,LGA_NAME', returnGeometry: 'false' }).then((b) => {
          const a = b.features?.[0]?.attributes;
          return a ? { code: a.SYM_CODE || '', name: a.LAY_CLASS || '', instrument: a.EPI_NAME || '' } : null;
        })
        : Promise.resolve(null);
      const roadsCall = state === 'NSW'
        ? upstream(`${SERVICES.nswRoads}/query`, { f: 'json', ...envelope({ minE: lotBox.minE - Math.min(nbM, 40), minN: lotBox.minN - Math.min(nbM, 40), maxE: lotBox.maxE + Math.min(nbM, 40), maxN: lotBox.maxN + Math.min(nbM, 40) }, srid), outFields: 'roadnamebase,roadnametype,roadnamesuffix', returnGeometry: 'true', outSR: String(srid), resultRecordCount: '40' }, { retries: 0, timeoutMs: 10000 })
        : Promise.resolve({ features: [] });
      // The NSW cadastre layer rejects resultRecordCount ("Failed to execute query"), so no count is sent; it returns up to its own limit. Big lots
      // (rural) get simplified geometry so the response stays small; a failed GET is retried once as a form POST.
      const bigLot = Math.max(lotBox.maxE - lotBox.minE + 2 * nbM, lotBox.maxN - lotBox.minN + 2 * nbM) > 600;
      const nbParams = { f: 'json', ...envelope(around, srid), outFields: fields, returnGeometry: 'true', outSR: String(srid), ...(bigLot ? { maxAllowableOffset: nbM > 150 ? '2' : '1', geometryPrecision: '1' } : {}), ...(state === 'QLD' ? { resultRecordCount: '300' } : {}) };
      const nbCall = upstream(`${layer}/query`, nbParams, { retries: 0 }).catch(() => upstream(`${layer}/query`, nbParams, { post: true, retries: 0 }));
      const notes = [];
      const [lga, zoning, roadsBody, nbBody] = await Promise.all([
        lgaCall.catch(() => { notes.push('Council not found.'); return ''; }),
        zoneCall.catch(() => { notes.push('Zoning could not be looked up.'); return null; }),
        roadsCall.catch(() => ({ features: [] })),
        nbCall.catch(() => { notes.push('Neighbouring lots could not be loaded.'); return { features: [] }; }),
      ]);
      const seen = new Set([parcel.id]);
      const neighbours = [];
      for (const f of nbBody.features || []) {
        const p = parcelOf(state, f);
        if (!p || seen.has(p.id)) continue;
        seen.add(p.id);
        const polys = p.polys.filter((q) => polygonArea(q) > 1);
        if (!polys.length) continue;
        const big = polys.reduce((a, b) => (polygonArea(b) > polygonArea(a) ? b : a));
        neighbours.push({ lotNumber: p.lotNumber, planLabel: p.planLabel, lotLabel: formatLotLabel(p), areaM2: round(polygonArea(big), 1), isRoad: p.isRoad, polygons: polysRel([big], origin) });
      }
      const roads = [];
      for (const f of roadsBody.features || []) {
        const name = [f.attributes?.roadnamebase, f.attributes?.roadnametype, f.attributes?.roadnamesuffix].filter(Boolean).join(' ');
        for (const path of f.geometry?.paths || []) roads.push({ name, points: path.map(([e, n]) => [round(e - origin.e, 2), round(n - origin.n, 2)]) });
      }
      const usedParts = parts.length ? parts : [biggest];
      const area = round(usedParts.reduce((t, q) => t + polygonArea(q), 0), 1);
      return {
        state,
        srid,
        zone,
        origin,
        query: { lon, lat },
        lot: {
          lotNumber: parcel.lotNumber,
          section: parcel.section,
          planLabel: parcel.planLabel,
          lotLabel: formatLotLabel(parcel),
          lotPlan: parcel.lotPlan,
          areaM2: area,
          registeredAreaM2: parcel.registered,
          polygons: polysRel(usedParts, origin),
          bboxMga: { minE: round(lotBox.minE, 3), minN: round(lotBox.minN, 3), maxE: round(lotBox.maxE, 3), maxN: round(lotBox.maxN, 3) },
        },
        neighbours,
        roads: roads.slice(0, 40),
        lga: state === 'QLD' && !lga ? parcel.shire || '' : lga,
        zoning,
        zoneNote: state === 'QLD'
          ? 'Queensland planning schemes are made by each council, so the zone is not looked up here. Check the zoning with the local council.'
          : zoning ? null : 'No land zone was found for this lot.',
        notes,
        attribution: state === 'QLD' ? QLD_CADASTRE_ATTR : NSW_CADASTRE_ATTR,
        retrieved: iso(),
      };
    }, { ttlFor: (v, ttl) => ((v.notes || []).some((n) => /Neighbouring lots could not be loaded/.test(n)) ? 0 : ttl) }); // a partial result (neighbours failed) is never stored, so the next lookup retries
    const partial = (value.notes || []).some((n) => /Neighbouring lots could not be loaded/.test(n));
    return json(value, 200, { 'cache-control': partial ? 'no-store' : 'public, max-age=3600' });
  }

  // Aerial -------------------------------------------------------------------------------------------------------------------------
  function pixelSize(box, res, maxW, maxH) {
    let w = (box.maxE - box.minE) / res;
    let h = (box.maxN - box.minN) / res;
    const k = Math.max(1, w / maxW, h / maxH);
    w = Math.max(16, Math.ceil(w / k));
    h = Math.max(16, Math.ceil(h / k));
    return { w, h };
  }

  async function nswCaptureDate(lon, lat) {
    try {
      const b = await upstream(`${SERVICES.nswImageryDates}/query`, { f: 'json', ...point(lon, lat), outFields: 'BlockStartDate,Resolution_cm', returnGeometry: 'false', orderByFields: 'BlockStartDate DESC' }, { retries: 0, timeoutMs: 8000 });
      const ms = b.features?.[0]?.attributes?.BlockStartDate;
      return ms ? ddmmyyyy(ms) : null;
    } catch {
      return null;
    }
  }

  // QLD: use the picture only where every sampled catalogue item is SISP aerial at least three years old (openly licensed). Planet satellite
  // fill and recent imagery are not open. Returns { ok, captureDate, reason }.
  async function openAerialItems(box, zone) {
    const fx = [[0.5, 0.5], [0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9]];
    const items = [];
    for (const [a, b] of fx) {
      const e = box.minE + a * (box.maxE - box.minE);
      const n = box.minN + b * (box.maxN - box.minN);
      const w = mgaToWeb(e, n, zone);
      let body;
      try {
        body = await upstream(`${SERVICES.qldImagery}/identify`, { f: 'json', geometry: JSON.stringify({ x: w.x, y: w.y, spatialReference: { wkid: 102100 } }), geometryType: 'esriGeometryPoint', returnCatalogItems: 'true', returnGeometry: 'false', returnPixelValues: 'false' }, { retries: 0, timeoutMs: 10000 });
      } catch {
        return { ok: false, reason: 'The Queensland imagery service could not confirm what imagery covers this lot.' };
      }
      const feats = body.catalogItems?.features || [];
      const top = feats.find((f) => f.attributes?.objectid === body.objectId) || feats[0];
      if (!top) return { ok: false, reason: 'No Queensland aerial imagery was found at this lot.' };
      items.push(top.attributes || {});
    }
    const threeYears = now() - 3 * 365.25 * 86400000;
    const bad = items.find((t) => /planet|satellite|sentinel|landsat/i.test(`${t.name || ''} ${t.metalink || ''}`) || !(t.captureend || t.capturestart) || (t.captureend || t.capturestart) > threeYears);
    if (bad) return { ok: false, reason: 'Only Queensland aerial imagery that is three years old or older is openly licensed, and none is available for this lot.' };
    const starts = items.map((t) => t.capturestart || t.captureend);
    const ends = items.map((t) => t.captureend || t.capturestart);
    const lo = Math.min(...starts);
    const hi = Math.max(...ends);
    return { ok: true, captureDate: lo === hi || ddmmyyyy(lo) === ddmmyyyy(hi) ? ddmmyyyy(lo) : `${ddmmyyyy(lo)} to ${ddmmyyyy(hi)}` };
  }

  async function aerial(request, url) {
    await rateLimit(request, 'aerial');
    const state = stateParam(url, { required: true });
    const { srid, zone } = srsFor(url);
    const box = parseBbox(url.searchParams.get('bbox'));
    const res = Math.min(2, Math.max(0.05, Number(url.searchParams.get('res')) || 0.1));
    const key = `aerial:${state}:${srid}:${[box.minE, box.minN, box.maxE, box.maxN].map((v) => round(v, 1)).join(',')}:${res}`;
    let hit = await bytesCache.get(key);
    if (!hit) {
      hit = await buildAerial(state, srid, zone, box, res);
      await bytesCache.put(key, hit, TTL.aerial);
    }
    return new Response(hit.body, { status: 200, headers: { ...hit.headers, 'cache-control': 'public, max-age=86400', 'x-content-type-options': 'nosniff' } });
  }

  async function buildAerial(state, srid, zone, box, res) {
    const centre = mgaToLonLat((box.minE + box.maxE) / 2, (box.minN + box.maxN) / 2, zone);
    const nsw = state === 'NSW';
    const maxW = 4096;
    const maxH = nsw ? 4096 : 2048;
    const { w, h } = pixelSize(box, res, maxW, maxH);
    let capture = null;
    let source;
    let attribution;
    let licence;
    if (nsw) {
      source = 'NSW Imagery (NSW Spatial Services)';
      attribution = 'Imagery: NSW Spatial Services, (c) Department of Customer Service 2020. Includes third party imagery (AAM, Jacobs Group Ausimage, Landsat).';
      licence = 'CC BY 3.0 AU as listed by NSW LPI; service metadata states no licence and notes third party imagery. Verify terms before commercial use.';
      capture = await nswCaptureDate(centre.lon, centre.lat);
    } else {
      const open = await openAerialItems(box, zone);
      if (!open.ok) throw new HttpError('NOT_FOUND', open.reason, { reason: 'IMAGERY_NOT_OPEN' });
      capture = open.captureDate;
      source = 'Queensland latest state program imagery (aerial, three years or older)';
      attribution = 'Imagery: State of Queensland (Department of Natural Resources and Mines, Manufacturing and Regional and Rural Development), State Remotely Sensed Image Library, CC BY-SA. The State gives no warranty for this data and accepts no liability.';
      licence = 'CC BY-SA (as stated by the service) for SISP aerial three years or older. Planet satellite fill is not used.';
    }
    const exportUrl = nsw ? `${SERVICES.nswImagery}/export` : `${SERVICES.qldImagery}/exportImage`;
    const fmt = { format: 'jpg', f: 'image' };
    const baseMeta = { source, attribution, licence, captureDate: capture, retrieved: iso() };
    // First choice: draw directly in MGA so the picture is already north up in the grid.
    let direct = null;
    for (const f of [1, 0.5]) {
      const dw = Math.max(64, Math.round(w * f));
      const dh = Math.max(64, Math.round(h * f));
      try {
        direct = await upstream(exportUrl, { bbox: `${box.minE},${box.minN},${box.maxE},${box.maxN}`, bboxSR: String(srid), imageSR: String(srid), size: `${dw},${dh}`, ...fmt }, { as: 'bytes', timeoutMs: 40000, retries: 0 });
        if (/^image\//i.test(direct.type) && direct.bytes.length >= 200) {
          direct.w = dw;
          direct.h = dh;
          break;
        }
      } catch {
        /* logged by upstream; try the smaller size, then web mercator */
      }
      direct = null;
    }
    if (direct) {
      const meta = { ...baseMeta, georef: 'mga', srid, zone, bbox: box, widthPx: direct.w, heightPx: direct.h, mmPerPx: round(((box.maxE - box.minE) / direct.w) * 1000, 3) };
      return { body: direct.bytes.buffer.slice(direct.bytes.byteOffset, direct.bytes.byteOffset + direct.bytes.byteLength), headers: { 'content-type': direct.type.split(';')[0], 'x-site-meta': encodeURIComponent(JSON.stringify(meta)) } };
    }
    // Fallback: web mercator over a box that covers the MGA box; the browser re-samples it north up (src/site/warp.js).
    const wb = mgaBoxToWebBox(box, zone);
    const k = 1 / Math.cos((centre.lat * Math.PI) / 180); // web units per ground metre
    const ww = Math.min(maxW, Math.ceil(((wb.maxX - wb.minX) / k) / res));
    const wh = Math.min(maxH, Math.ceil(((wb.maxY - wb.minY) / k) / res));
    const web = await upstream(exportUrl, { bbox: `${wb.minX},${wb.minY},${wb.maxX},${wb.maxY}`, bboxSR: '3857', imageSR: '3857', size: `${ww},${wh}`, ...fmt }, { as: 'bytes', timeoutMs: 40000 });
    if (!/^image\//i.test(web.type) || web.bytes.length < 200) throw new HttpError('SITE_UPSTREAM', 'The imagery service did not return a picture.');
    const meta = { ...baseMeta, georef: 'web-mercator', srid, zone, bbox: box, webBbox: { minX: wb.minX, minY: wb.minY, maxX: wb.maxX, maxY: wb.maxY }, widthPx: ww, heightPx: wh, outWidthPx: w, outHeightPx: h, mmPerPx: round(((box.maxE - box.minE) / w) * 1000, 3) };
    return { body: web.bytes.buffer.slice(web.bytes.byteOffset, web.bytes.byteOffset + web.bytes.byteLength), headers: { 'content-type': web.type.split(';')[0], 'x-site-meta': encodeURIComponent(JSON.stringify(meta)) } };
  }

  // Contours -----------------------------------------------------------------------------------------------------------------------
  // Bilinear sample of a raster (row 0 at the top) at fractional pixel position; NoData neighbours are skipped.
  function sampleRaster(r, fx, fy, nodata) {
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const at = (x, y) => {
      const cx = Math.min(r.width - 1, Math.max(0, x));
      const cy = Math.min(r.height - 1, Math.max(0, y));
      const v = r.data[cy * r.width + cx];
      return Number.isFinite(v) && v > NODATA + 1 && v > -500 && (nodata == null || v !== nodata) ? v : null;
    };
    const v = [at(x0, y0), at(x0 + 1, y0), at(x0, y0 + 1), at(x0 + 1, y0 + 1)];
    const wgt = [(1 - tx) * (1 - ty), tx * (1 - ty), (1 - tx) * ty, tx * ty];
    let s = 0;
    let ws = 0;
    v.forEach((z, i) => {
      if (z != null) {
        s += z * wgt[i];
        ws += wgt[i];
      }
    });
    return ws > 0.0001 ? s / ws : null;
  }

  async function qldLidar(box, srid) {
    try {
      const b = await upstream(`${SERVICES.qldLidar}/query`, { f: 'json', ...envelope(box, srid), outFields: 'project_name,start_date,end_date,geotif_dem,horiz_acc,vert_acc', returnGeometry: 'false', resultRecordCount: '50' }, { retries: 0, timeoutMs: 10000 });
      const tiles = (b.features || []).map((f) => f.attributes).filter((a) => String(a.geotif_dem || '').trim());
      return { known: true, tiles };
    } catch {
      return { known: false, tiles: [] };
    }
  }

  async function contours(request, url) {
    await rateLimit(request, 'contours');
    const state = stateParam(url, { required: true });
    const { srid, zone } = srsFor(url);
    const lotBox = parseBbox(url.searchParams.get('bbox'));
    const buffer = Math.min(100, Math.max(0, Number(url.searchParams.get('buffer') ?? 10)));
    const minor = Math.min(5, Math.max(0.1, Number(url.searchParams.get('minor')) || 0.5));
    let major = Number(url.searchParams.get('major')) || 2.5;
    major = Math.max(minor, Math.round(major / minor) * minor);
    const [oe, on] = (url.searchParams.get('origin') || '').split(',').map(Number);
    const origin = Number.isFinite(oe) && Number.isFinite(on) ? { e: oe, n: on } : { e: round((lotBox.minE + lotBox.maxE) / 2, 3), n: round((lotBox.minN + lotBox.maxN) / 2, 3) };
    const key = `contours:${state}:${srid}:${[lotBox.minE, lotBox.minN, lotBox.maxE, lotBox.maxN].map((v) => round(v, 1)).join(',')}:${buffer}:${minor}:${major}:${origin.e},${origin.n}:${url.searchParams.get('cell') || ''}`;
    const hit = await bytesCache.get(key);
    if (hit) return new Response(hit.body, { status: 200, headers: { ...hit.headers, 'cache-control': 'public, max-age=86400' } });
    const result = await buildContours({ state, srid, zone, lotBox, buffer, minor, major, origin, cellParam: Number(url.searchParams.get('cell')) || 0 });
    const body = JSON.stringify(result);
    const out = { body: new TextEncoder().encode(body).buffer, headers: { 'content-type': 'application/json; charset=utf-8' } };
    await bytesCache.put(key, out, TTL.contours);
    return new Response(out.body, { status: 200, headers: { ...out.headers, 'cache-control': 'public, max-age=86400' } });
  }

  async function buildContours({ state, srid, zone, lotBox, buffer, minor, major, origin, cellParam }) {
    const box = { minE: lotBox.minE - buffer, minN: lotBox.minN - buffer, maxE: lotBox.maxE + buffer, maxN: lotBox.maxN + buffer };
    const nsw = state === 'NSW';
    let cell = cellParam || (nsw ? 2 : 1);
    const cols0 = (b) => Math.floor((b.maxE - b.minE) / cell) + 1;
    const rows0 = (b) => Math.floor((b.maxN - b.minN) / cell) + 1;
    while (cols0(box) * rows0(box) > 160000) cell *= 1.25;
    cell = round(cell, 2);
    const cols = cols0(box);
    const rows = rows0(box);
    // Raster request in web mercator, a cell beyond the box on every side so edge nodes interpolate properly.
    const pad = cell * 3;
    const wb = mgaBoxToWebBox({ minE: box.minE - pad, minN: box.minN - pad, maxE: box.maxE + pad, maxN: box.maxN + pad }, zone);
    const mid = mgaToLonLat((box.minE + box.maxE) / 2, (box.minN + box.maxN) / 2, zone);
    const k = 1 / Math.cos((mid.lat * Math.PI) / 180);
    let px = nsw ? 5 : Math.max(0.3, cell * k); // web units per pixel: the native 5 unit cell for NSW, about the output cell for QLD
    const maxW = nsw ? 4096 : 4096;
    const maxH = nsw ? 4096 : 2048;
    let x0 = wb.minX;
    let y1 = wb.maxY;
    if (nsw) {
      x0 = Math.floor(wb.minX / px) * px; // align to the service's 5 unit grid so nearest neighbour returns native cells
      y1 = Math.ceil(wb.maxY / px) * px;
    }
    let w = Math.ceil((wb.maxX - x0) / px);
    let h = Math.ceil((y1 - wb.minY) / px);
    while (w > maxW || h > maxH) {
      px *= 1.25;
      w = Math.ceil((wb.maxX - x0) / px);
      h = Math.ceil((y1 - wb.minY) / px);
    }
    const bboxWeb = [x0, y1 - h * px, x0 + w * px, y1];
    const service = nsw ? SERVICES.nswDem : SERVICES.qldDem;
    const raster = await upstream(`${service}/exportImage`, {
      bbox: bboxWeb.join(','), bboxSR: '102100', imageSR: '102100', size: `${w},${h}`, format: 'tiff', pixelType: 'F32', noData: String(NODATA),
      interpolation: nsw ? 'RSP_NearestNeighbor' : 'RSP_BilinearInterpolation', compression: 'None', f: 'image',
    }, { as: 'bytes', timeoutMs: 90000, retries: 1 });
    let tif;
    try {
      tif = await readTiff(raster.bytes);
    } catch (e) {
      throw new HttpError('SITE_UPSTREAM', 'The elevation service did not return a readable raster.', { detail: String(e?.message).slice(0, 120), head: String(new TextDecoder().decode(raster.bytes.subarray(0, 100))).replace(/[^\x20-\x7e]/g, '') });
    }
    // Resample onto the MGA grid. Column 0 is the west edge, row 0 the north edge.
    const values = new Array(cols * rows);
    let valid = 0;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const e = box.minE + i * cell;
        const n = box.maxN - j * cell;
        const wxy = mgaToWeb(e, n, zone);
        const fx = (wxy.x - bboxWeb[0]) / px - 0.5;
        const fy = (bboxWeb[3] - wxy.y) / px - 0.5;
        const z = sampleRaster(tif, fx, fy, tif.nodata);
        values[j * cols + i] = z;
        if (z != null) valid++;
      }
    }
    if (!valid) throw new HttpError('NOT_FOUND', 'No ground levels are available for this lot.');
    const grid = { cols, rows, cell, x0: round(box.minE - origin.e, 3), y0: round(box.maxN - origin.n, 3), values };
    fillGaps(grid);
    grid.values = grid.values.map((v) => round(v, 2));
    const { min, max } = gridRange(grid);
    const lines = contourLines(grid, { minor, major });
    let provenance;
    if (nsw) {
      provenance = {
        source: 'NSW 5 m DEM (NSW_5M_Elevation, derived from stereo imagery)', service, resolutionM: 5, datum: 'AHD (orthometric, per the service heightModelInfo)',
        accuracy: 'not stated by the service', copyright: 'DFSI 2019', licence: 'not stated by the service', retrieved: iso(),
        note: 'NSW 5 m DEM, indicative only; detailed survey required',
      };
    } else {
      const lidar = await qldLidar(box, srid);
      const res = lidar.tiles.map((t) => t.geotif_dem).filter(Boolean);
      const projects = [...new Set(lidar.tiles.map((t) => t.project_name).filter(Boolean))];
      const acc = [...new Set(lidar.tiles.map((t) => t.vert_acc).filter(Boolean))];
      const covered = lidar.tiles.length > 0;
      provenance = {
        source: covered ? 'Queensland LiDAR DEM (QldDem mosaic)' : 'Queensland DEM (QldDem mosaic, no LiDAR coverage found: 30 m SRTM fill likely)', service,
        resolutionM: covered ? (/0\.5/.test(res.join(' ')) ? 0.5 : 1) : lidar.known ? 30 : null,
        datum: 'not stated by the service (AHD not confirmed)', accuracy: acc.length ? acc.join('; ') : 'not stated', lidarProjects: projects,
        copyright: 'State of Queensland and Commonwealth of Australia', licence: 'not stated by the service (CC BY-SA per the JCE owner instruction of 15/10/2026)', retrieved: iso(),
        note: covered ? 'Queensland LiDAR DEM, State of Queensland, CC BY-SA, indicative only; detailed survey required' : 'Queensland DEM without LiDAR coverage, State of Queensland, CC BY-SA, very coarse, indicative only; detailed survey required',
      };
    }
    return { srid, origin, minor, major, minRL: min, maxRL: max, grid, contours: lines, provenance };
  }

  // Health -------------------------------------------------------------------------------------------------------------------------
  const PROBES = [
    ['nsw-cadastre', SERVICES.nswLot, true], ['nsw-addresses', SERVICES.nswAddresses, true], ['nsw-property', SERVICES.nswProperty, false], ['nsw-lga', SERVICES.nswLga, false], ['nsw-zoning', SERVICES.nswZoning, false],
    ['nsw-roads', SERVICES.nswRoads, false], ['nsw-imagery', SERVICES.nswImagery, false], ['nsw-dem', SERVICES.nswDem, false],
    ['qld-parcels', SERVICES.qldLot, true], ['qld-addresses', SERVICES.qldAddresses, true], ['qld-lga', SERVICES.qldLga, false],
    ['qld-imagery', SERVICES.qldImagery, false], ['qld-dem', SERVICES.qldDem, false], ['qld-lidar-extents', SERVICES.qldLidar, false],
  ];
  let healthMemo = null;

  async function health(request) {
    await rateLimit(request, 'health');
    if (healthMemo && healthMemo.until > now()) return json(healthMemo.body, 200, { 'cache-control': 'no-store' });
    const checks = await Promise.all(PROBES.map(async ([id, url, required]) => {
      const t0 = now();
      try {
        const body = await upstream(url, { f: 'json' }, { timeoutMs: 8000, retries: 0 });
        const ok = !!(body && (body.name || body.currentVersion || body.fields || body.layers || body.serviceDescription !== undefined || body.type));
        return { id, url, required, ok, ms: now() - t0, error: ok ? null : 'unexpected response' };
      } catch (e) {
        return { id, url, required, ok: false, ms: now() - t0, error: e?.extra?.detail || e?.message || 'failed' };
      }
    }));
    const body = { ok: checks.filter((c) => c.required).every((c) => c.ok), allOk: checks.every((c) => c.ok), checkedAt: iso(), upstreams: checks };
    healthMemo = { until: now() + TTL.health * 1000, body };
    return json(body, 200, { 'cache-control': 'no-store' });
  }

  // Router -------------------------------------------------------------------------------------------------------------------------
  async function handle(subpath, request, url) {
    if (request.method !== 'GET') throw new HttpError('BAD_REQUEST', 'Use GET for this endpoint.', {}, 405);
    if (subpath === '/search') return search(request, url);
    if (subpath === '/lot') return lot(request, url);
    if (subpath === '/aerial') return aerial(request, url);
    if (subpath === '/contours') return contours(request, url);
    if (subpath === '/health') return health(request);
    throw new HttpError('NOT_FOUND', 'No such endpoint.');
  }

  return { handle, search, lot, aerial, contours, health, buildContours, sampleRaster };
}

export { zoneForSrid, lonLatToMga, lonLatToWeb };
