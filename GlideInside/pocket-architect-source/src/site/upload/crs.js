// Coordinate systems for boundary upload: a searchable list (GDA2020 and GDA94 MGA zones 49 to 56, WGS 84 UTM zones worldwide, WGS 84
// longitude and latitude, or any proj4 string) and the transforms to and from longitude and latitude, using the vendored proj4.

import proj4 from '../../lib/proj4.cjs';

// GDA94 to GDA2020 as a seven parameter shift (EPSG 8048, written for proj4 in the position vector convention). It moves a GDA94 point
// about 1.5 m, which matters when a boundary is laid over an aerial. GDA2020 is treated as equal to WGS 84 (they agree to a few centimetres).
const TOWGS_GDA94 = '0.06155,-0.01087,-0.04019,0.0394924,0.0327221,0.0328979,-0.009994';
const TOWGS_NONE = '0,0,0,0,0,0,0';

export const WGS84_ID = 'wgs84';

const mgaDef = (zone, towgs) => `+proj=utm +zone=${zone} +south +ellps=GRS80 +towgs84=${towgs} +units=m +no_defs`;
const utmDef = (zone, south) => `+proj=utm +zone=${zone}${south ? ' +south' : ''} +ellps=WGS84 +datum=WGS84 +units=m +no_defs`;

let LIST = null;

/** Every named coordinate system: { id, label, epsg, group, def, kind: 'lonlat' | 'projected' }. */
export function listCrs() {
  if (LIST) return LIST;
  const out = [{ id: WGS84_ID, label: 'WGS 84 longitude and latitude (EPSG:4326), also GDA2020 and GDA94 degrees', epsg: 4326, group: 'Geographic', def: '+proj=longlat +datum=WGS84 +no_defs', kind: 'lonlat' }];
  for (let z = 49; z <= 56; z++) out.push({ id: `mga2020:${z}`, label: `GDA2020 / MGA zone ${z} (EPSG:${7800 + z})`, epsg: 7800 + z, group: 'Australia', def: mgaDef(z, TOWGS_NONE), kind: 'projected' });
  for (let z = 49; z <= 56; z++) out.push({ id: `mga94:${z}`, label: `GDA94 / MGA zone ${z} (EPSG:${28300 + z})`, epsg: 28300 + z, group: 'Australia', def: mgaDef(z, TOWGS_GDA94), kind: 'projected' });
  for (let z = 1; z <= 60; z++) out.push({ id: `utm:${z}N`, label: `WGS 84 / UTM zone ${z}N (EPSG:${32600 + z})`, epsg: 32600 + z, group: 'UTM north', def: utmDef(z, false), kind: 'projected' });
  for (let z = 1; z <= 60; z++) out.push({ id: `utm:${z}S`, label: `WGS 84 / UTM zone ${z}S (EPSG:${32700 + z})`, epsg: 32700 + z, group: 'UTM south', def: utmDef(z, true), kind: 'projected' });
  LIST = out;
  return out;
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9: ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Search the list by id, EPSG number or words ("mga 56", "utm 32n", "7856", "gda94"). An empty query gives the first `limit`. */
export function searchCrs(query, limit = 40) {
  const all = listCrs();
  const q = norm(query);
  if (!q) return all.slice(0, limit);
  const words = q.split(' ');
  const hit = all.filter((c) => {
    const hay = norm(`${c.id} ${c.label} ${c.epsg} ${c.group}`).replace(/\bmga\b/g, 'mga').replace(/\bzone\b/g, 'zone');
    return words.every((w) => hay.includes(w) || (/^\d+[ns]$/.test(w) && hay.includes(`zone ${w}`)));
  });
  return hit.slice(0, limit);
}

/** A named system by id or EPSG number, or null. */
export function crsById(id) {
  const all = listCrs();
  if (typeof id === 'number' || /^\d+$/.test(String(id))) return all.find((c) => c.epsg === Number(id)) || null;
  const s = String(id || '').toLowerCase().replace(/^epsg:/, '');
  if (/^\d+$/.test(s)) return all.find((c) => c.epsg === Number(s)) || null;
  return all.find((c) => c.id.toLowerCase() === s) || null;
}

const customCache = new Map();

/**
 * Resolve any system description to a proj4 converter: a named id, a { wkt } or { proj4 } object, a bare proj4 string, or a WKT string.
 * Returns { def, kind } or throws Error with a readable message.
 */
export function resolveCrs(spec) {
  if (!spec) throw new Error('Choose a coordinate system first.');
  if (typeof spec === 'string') {
    const named = crsById(spec);
    if (named) return { def: named.def, kind: named.kind, label: named.label };
    return resolveText(spec);
  }
  if (spec.id) return resolveCrs(spec.id);
  if (spec.wkt) return resolveText(spec.wkt);
  if (spec.proj4) return resolveText(spec.proj4);
  throw new Error('That coordinate system is not recognised.');
}

function resolveText(text) {
  const t = String(text).trim();
  if (customCache.has(t)) return customCache.get(t);
  let conv;
  try {
    conv = proj4(t);
  } catch {
    throw new Error('That proj4 or WKT text could not be read. Check it, or pick a system from the list.');
  }
  if (!conv || !conv.oProj) throw new Error('That coordinate system could not be read.');
  const geographic = !!conv.oProj.projName && /longlat|latlong|lonlat|latlon/i.test(conv.oProj.projName);
  const unitsOk = geographic || conv.oProj.units === 'm' || conv.oProj.units == null || conv.oProj.to_meter === 1;
  const r = { def: t, kind: geographic ? 'lonlat' : 'projected', label: 'Custom coordinate system', nonMetre: !unitsOk, toMeter: conv.oProj.to_meter || 1 };
  customCache.set(t, r);
  return r;
}

/** [x, y] in the system to [lon, lat] (WGS 84). */
export function toLonLat(spec, x, y) {
  const r = resolveCrs(spec);
  if (r.kind === 'lonlat') {
    const ll = proj4(r.def, 'EPSG:4326', [x, y]);
    return [ll[0], ll[1]];
  }
  const ll = proj4(r.def, 'EPSG:4326', [x, y]);
  if (!Number.isFinite(ll[0]) || !Number.isFinite(ll[1])) throw new Error('These coordinates do not fit that coordinate system. Try another zone.');
  return [ll[0], ll[1]];
}

/** [lon, lat] to [x, y] in the system. */
export function fromLonLat(spec, lon, lat) {
  const r = resolveCrs(spec);
  const p = proj4('EPSG:4326', r.def, [lon, lat]);
  return [p[0], p[1]];
}

/** A transverse mercator frame centred on a longitude, scale 1 on the centre line: metres that are true near the site. */
export const localTmDef = (lon0) => `+proj=tmerc +lat_0=0 +lon_0=${Number(lon0).toFixed(6)} +k=1 +x_0=500000 +y_0=0 +ellps=WGS84 +datum=WGS84 +units=m +no_defs`;

/** Best guess of the zone for a pair of numbers that look like MGA or UTM, so the dialog can start somewhere sensible. */
export function guessProjected(e, n) {
  if (Math.abs(e) <= 180 && Math.abs(n) <= 90) return WGS84_ID;
  if (e > 100000 && e < 900000 && n > 5.5e6 && n < 1.1e7) return 'mga2020:56';
  return null;
}

/** Rough check that the numbers can be longitude and latitude in degrees. */
export const looksLonLat = (a, b) => Math.abs(a) <= 180 && Math.abs(b) <= 90;
