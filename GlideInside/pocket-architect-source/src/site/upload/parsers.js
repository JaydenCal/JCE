// Boundary file readers. Each reader returns
//   { format, polygons: [{ name, ring: [[x, y]], holes: [[[x, y]]], layer? }], coordKind: 'lonlat' | 'xy', crs: spec | null,
//     needsCrs: boolean, units?: 'm' | 'mm' | 'ft' | ..., warnings: [text] }
// The ring is open (no repeated closing point), x is longitude or easting, y is latitude or northing. Pure, no DOM, no network.
// KML is read with a small tag scanner (no DOMParser) so the same code runs in the browser and in tests.

import { unzipSync, strFromU8 } from '../../lib/fflate.js';
import { resolveCrs, WGS84_ID, looksLonLat } from './crs.js';

export class UploadError extends Error {
  constructor(message, code = 'UPLOAD') {
    super(message);
    this.name = 'UploadError';
    this.code = code;
  }
}

const num = (v) => Number(v);
const finite = (a) => a.length >= 2 && Number.isFinite(a[0]) && Number.isFinite(a[1]);

/** Drop the repeated closing vertex and consecutive duplicates. */
export function openRing(pts, tol = 1e-9) {
  const out = [];
  for (const p of pts) {
    if (!finite(p)) continue;
    const q = out[out.length - 1];
    if (q && Math.abs(q[0] - p[0]) <= tol && Math.abs(q[1] - p[1]) <= tol) continue;
    out.push([p[0], p[1]]);
  }
  if (out.length > 1) {
    const a = out[0];
    const b = out[out.length - 1];
    if (Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol) out.pop();
  }
  return out;
}

const area2 = (r) => {
  let s = 0;
  for (let i = 0; i < r.length; i++) {
    const a = r[i];
    const b = r[(i + 1) % r.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s;
};

const mkPoly = (name, ring, holes = [], extra = {}) => ({ name: String(name || '').trim(), ring: openRing(ring), holes: holes.map((h) => openRing(h)).filter((h) => h.length >= 3), ...extra });
const valid = (p) => p.ring.length >= 3 && Math.abs(area2(p.ring)) > 0;

// Text from bytes: UTF-8 with an optional BOM, falling back to latin1 when the bytes are not valid UTF-8.
export function textOf(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(u8).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('latin1').decode(u8);
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// GeoJSON

const EPSG_IN_NAME = /(?:EPSG|CRS)(?:::|:)(\d{4,6})/i;

export function parseGeoJSON(input) {
  const text = typeof input === 'string' ? input : textOf(input);
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new UploadError('That file is not valid GeoJSON. Check that it is a complete .geojson or .json file.', 'BAD_JSON');
  }
  const warnings = [];
  const polygons = [];
  let crs = WGS84_ID;
  const named = json?.crs?.properties?.name;
  if (named) {
    const m = EPSG_IN_NAME.exec(String(named));
    if (m && !/CRS84|4326/.test(String(named))) {
      try { resolveCrs(m[1]); crs = m[1]; } catch { warnings.push(`The file names coordinate system ${named}, which is not in the list. It was read as longitude and latitude.`); }
    }
  }
  const addPoly = (coords, props) => {
    if (!Array.isArray(coords) || !coords.length) return;
    const p = mkPoly(nameFromProps(props) || `Polygon ${polygons.length + 1}`, coords[0], coords.slice(1));
    if (valid(p)) polygons.push(p);
  };
  const walk = (g, props) => {
    if (!g) return;
    if (g.type === 'Polygon') addPoly(g.coordinates, props);
    else if (g.type === 'MultiPolygon') (g.coordinates || []).forEach((c) => addPoly(c, props));
    else if (g.type === 'GeometryCollection') (g.geometries || []).forEach((x) => walk(x, props));
    else if (g.type === 'LineString') {
      const c = g.coordinates || [];
      const a = c[0];
      const b = c[c.length - 1];
      if (c.length >= 4 && a && b && a[0] === b[0] && a[1] === b[1]) addPoly([c], props);
      else warnings.push('An open line in the file was skipped. Only closed outlines are used.');
    } else if (g.type === 'Feature') walk(g.geometry, g.properties);
    else if (g.type === 'FeatureCollection') (g.features || []).forEach((f) => walk(f, null));
  };
  walk(json, null);
  return { format: 'GeoJSON', polygons, coordKind: crs === WGS84_ID ? 'lonlat' : 'xy', crs, needsCrs: false, warnings };
}

const NAME_KEYS = ['name', 'Name', 'NAME', 'lot', 'Lot', 'LOT', 'lotplan', 'LOTPLAN', 'label', 'Label', 'id', 'ID', 'title'];
function nameFromProps(props) {
  if (!props || typeof props !== 'object') return '';
  for (const k of NAME_KEYS) if (props[k] != null && String(props[k]).trim()) return String(props[k]).trim();
  return '';
}

// ---------------------------------------------------------------------------------------------------------------------------------
// KML and KMZ

const decodeXml = (s) => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').trim();
const tagRe = (tag, flags = 'gi') => new RegExp(`<(?:\\w+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, flags);

function kmlCoords(block) {
  const pts = [];
  for (const m of block.matchAll(tagRe('coordinates'))) {
    for (const tok of m[1].trim().split(/\s+/)) {
      if (!tok) continue;
      const [lon, lat] = tok.split(',').map(num);
      if (Number.isFinite(lon) && Number.isFinite(lat)) pts.push([lon, lat]);
    }
  }
  return pts;
}

export function parseKML(input) {
  const text = typeof input === 'string' ? input : textOf(input);
  if (!/<(?:\w+:)?kml[\s>]/i.test(text) && !/<(?:\w+:)?Placemark/i.test(text)) throw new UploadError('That file does not look like KML. Check that it is a .kml file exported from Google Earth or a GIS.', 'BAD_KML');
  const polygons = [];
  const warnings = [];
  let skippedLines = 0;
  const marks = [...text.matchAll(tagRe('Placemark'))];
  const blocks = marks.length ? marks.map((m) => m[1]) : [text];
  blocks.forEach((b, i) => {
    const nm = tagRe('name', 'i').exec(b.replace(tagRe('(?:Polygon|LinearRing|LineString)'), ''));
    const name = nm ? decodeXml(nm[1]) : '';
    let n = 0;
    for (const pm of b.matchAll(tagRe('Polygon'))) {
      const outer = tagRe('outerBoundaryIs', 'i').exec(pm[1]);
      const inner = [...pm[1].matchAll(tagRe('innerBoundaryIs'))];
      const p = mkPoly(name || `Placemark ${i + 1}`, kmlCoords(outer ? outer[1] : pm[1]), inner.map((x) => kmlCoords(x[1])));
      if (valid(p)) { n += 1; polygons.push(p); }
    }
    if (!n) {
      for (const lm of b.matchAll(tagRe('(?:LinearRing|LineString)'))) {
        const pts = kmlCoords(lm[1]);
        const a = pts[0];
        const z = pts[pts.length - 1];
        if (pts.length >= 4 && a[0] === z[0] && a[1] === z[1]) {
          const p = mkPoly(name || `Outline ${i + 1}`, pts);
          if (valid(p)) polygons.push(p);
        } else skippedLines += 1;
      }
    }
  });
  if (skippedLines) warnings.push(`${skippedLines} open line${skippedLines > 1 ? 's' : ''} in the file ${skippedLines > 1 ? 'were' : 'was'} skipped. Only closed outlines are used.`);
  // Several polygons sharing one name get a number so the picker tells them apart.
  const seen = new Map();
  for (const p of polygons) {
    const k = p.name;
    seen.set(k, (seen.get(k) || 0) + 1);
  }
  const count = new Map();
  for (const p of polygons) if (seen.get(p.name) > 1) { const c = (count.get(p.name) || 0) + 1; count.set(p.name, c); p.name = `${p.name} (${c})`; }
  return { format: 'KML', polygons, coordKind: 'lonlat', crs: WGS84_ID, needsCrs: false, warnings };
}

export function parseKMZ(bytes) {
  let files;
  try {
    files = unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  } catch {
    throw new UploadError('That KMZ file could not be opened. Re-export it from Google Earth, or save as KML.', 'BAD_ZIP');
  }
  const names = Object.keys(files);
  const kml = names.find((n) => /(^|\/)doc\.kml$/i.test(n)) || names.find((n) => /\.kml$/i.test(n));
  if (!kml) throw new UploadError('There is no KML inside that KMZ file.', 'NO_KML');
  const out = parseKML(strFromU8(files[kml]));
  out.format = 'KMZ';
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Shapefile (.shp, .dbf, .prj), loose or inside a zip

const isOuterCw = (ring) => area2(ring) < 0; // ESRI: outer rings run clockwise (y up), so the signed area is negative

function pointInRing(pt, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** Read the polygon records of a .shp: [{ rings: [[x, y]] }] (all rings, orientation kept). */
export function readShp(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8.length < 100) throw new UploadError('That .shp file is too short to be a shapefile.', 'BAD_SHP');
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (dv.getInt32(0, false) !== 9994) throw new UploadError('That .shp file is not a valid shapefile.', 'BAD_SHP');
  const type = dv.getInt32(32, true);
  if (![5, 15, 25].includes(type)) throw new UploadError(type === 3 || type === 13 || type === 23 ? 'That shapefile holds lines, not areas. Export the lot boundary as polygons.' : 'That shapefile does not hold polygons. Export the lot boundary as polygons.', 'NOT_POLYGON');
  const out = [];
  let off = 100;
  while (off + 8 <= u8.length) {
    const len = dv.getInt32(off + 4, false) * 2;
    const start = off + 8;
    if (start + len > u8.length) break;
    const st = dv.getInt32(start, true);
    if (st === 0) { off = start + len; continue; }
    const nParts = dv.getInt32(start + 36, true);
    const nPts = dv.getInt32(start + 40, true);
    const partsAt = start + 44;
    const ptsAt = partsAt + 4 * nParts;
    const parts = [];
    for (let i = 0; i < nParts; i++) parts.push(dv.getInt32(partsAt + 4 * i, true));
    const rings = [];
    for (let i = 0; i < nParts; i++) {
      const a = parts[i];
      const b = i + 1 < nParts ? parts[i + 1] : nPts;
      const r = [];
      for (let k = a; k < b; k++) r.push([dv.getFloat64(ptsAt + 16 * k, true), dv.getFloat64(ptsAt + 16 * k + 8, true)]);
      rings.push(r);
    }
    out.push({ rings });
    off = start + len;
  }
  return out;
}

/** Read a .dbf as { fields: [name], rows: [{ name: value }] }. */
export function readDbf(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8.length < 33) return { fields: [], rows: [] };
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const nRec = dv.getUint32(4, true);
  const hdr = dv.getUint16(8, true);
  const recLen = dv.getUint16(10, true);
  const fields = [];
  for (let o = 32; o + 32 <= hdr && u8[o] !== 0x0d; o += 32) {
    const nm = new TextDecoder('latin1').decode(u8.subarray(o, o + 11)).replace(/\0.*$/, '');
    fields.push({ name: nm, len: u8[o + 16] });
  }
  const rows = [];
  for (let r = 0; r < nRec; r++) {
    const base = hdr + r * recLen;
    if (base + recLen > u8.length) break;
    let p = base + 1;
    const row = {};
    for (const f of fields) {
      row[f.name] = new TextDecoder('latin1').decode(u8.subarray(p, p + f.len)).trim();
      p += f.len;
    }
    rows.push(row);
  }
  return { fields: fields.map((f) => f.name), rows };
}

const ringsToPolygons = (records, dbf, warnings) => {
  const polygons = [];
  records.forEach((rec, ri) => {
    const outers = [];
    const holes = [];
    for (const r of rec.rings) {
      const o = openRing(r);
      if (o.length < 3) continue;
      (isOuterCw(r) ? outers : holes).push(o);
    }
    if (!outers.length && holes.length) { outers.push(holes.shift()); warnings.push('A ring in the shapefile had the opposite winding order and was read as an outline.'); }
    const props = dbf?.rows?.[ri] || null;
    const nm = nameFromProps(props) || (props ? Object.values(props).find((v) => v && String(v).length <= 40) : '') || '';
    outers.forEach((o, k) => {
      const mine = holes.filter((h) => pointInRing(h[0], o));
      const p = mkPoly(nm ? (outers.length > 1 ? `${nm} (${k + 1})` : nm) : `Polygon ${polygons.length + 1}`, o, mine);
      if (valid(p)) polygons.push(p);
    });
  });
  return polygons;
};

/** A .prj WKT to a CRS spec, or null when it cannot be read. */
export function crsFromPrj(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  try {
    resolveCrs({ wkt: t });
    return { wkt: t };
  } catch {
    return null;
  }
}

export function parseShapefile({ shp, dbf = null, prj = null, name = '' }) {
  const warnings = [];
  const records = readShp(shp);
  const table = dbf ? readDbf(dbf) : null;
  const polygons = ringsToPolygons(records, table, warnings);
  let crs = null;
  let coordKind = 'xy';
  if (prj) {
    const text = typeof prj === 'string' ? prj : textOf(prj);
    crs = crsFromPrj(text);
    if (!crs) warnings.push('The .prj file could not be read. Choose the coordinate system below.');
    else if (/^\s*GEOGCS/i.test(text) && !/PROJCS/i.test(text)) { coordKind = 'lonlat'; crs = WGS84_ID; }
  }
  const sample = polygons[0]?.ring[0];
  if (!crs && sample && looksLonLat(sample[0], sample[1])) { crs = WGS84_ID; coordKind = 'lonlat'; if (!prj) warnings.push('There is no .prj file. The numbers look like longitude and latitude, so they were read that way.'); }
  else if (!crs && !prj) warnings.push('There is no .prj file, so the coordinate system is not known. Choose it below.');
  return { format: 'Shapefile', polygons, coordKind, crs, needsCrs: !crs, warnings, name };
}

/** A zip holding a shapefile (.shp plus .dbf and .prj). */
export function parseShapefileZip(bytes) {
  let files;
  try {
    files = unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  } catch {
    throw new UploadError('That zip file could not be opened.', 'BAD_ZIP');
  }
  const names = Object.keys(files).filter((n) => !/^__MACOSX\//.test(n));
  const shps = names.filter((n) => /\.shp$/i.test(n));
  if (!shps.length) {
    const kml = names.find((n) => /\.(kml|geojson|json|dxf)$/i.test(n));
    if (kml) throw new UploadError(`That zip holds ${kml.split('.').pop().toUpperCase()}, not a shapefile. Unzip it and upload that file.`, 'NO_SHP');
    throw new UploadError('There is no .shp file in that zip. A shapefile needs at least the .shp, .dbf and .prj files.', 'NO_SHP');
  }
  const base = shps[0].replace(/\.shp$/i, '');
  const find = (ext) => names.find((n) => n.toLowerCase() === `${base}.${ext}`.toLowerCase()) || names.find((n) => new RegExp(`\\.${ext}$`, 'i').test(n));
  const out = parseShapefile({ shp: files[shps[0]], dbf: find('dbf') ? files[find('dbf')] : null, prj: find('prj') ? files[find('prj')] : null, name: base });
  if (shps.length > 1) out.warnings.unshift(`The zip holds ${shps.length} shapefiles. The first one (${shps[0]}) was read.`);
  out.format = 'Shapefile (zip)';
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// DXF (ASCII): closed LWPOLYLINE and POLYLINE, plus closed loops of LINE entities. DWG is not read.

const INSUNITS = { 0: null, 1: 'in', 2: 'ft', 4: 'mm', 5: 'cm', 6: 'm', 7: 'km', 10: 'yd' };
export const DWG_MESSAGE = 'DWG files cannot be read here. In your CAD software choose Save As, pick DXF (2010 ASCII DXF or older) and upload that file.';

function bulgeArc(a, b, bulge, out) {
  // Push a, then points along the arc from a to b for the given bulge (tan of a quarter of the included angle, positive anticlockwise).
  out.push(a);
  if (!bulge) return;
  const theta = 4 * Math.atan(bulge);
  const chord = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (chord === 0) return;
  const dx = (b[0] - a[0]) / chord;
  const dy = (b[1] - a[1]) / chord;
  const h = chord / 2 / Math.tan(theta / 2);
  const cx = (a[0] + b[0]) / 2 - dy * h;
  const cy = (a[1] + b[1]) / 2 + dx * h;
  const r = Math.hypot(a[0] - cx, a[1] - cy);
  const a0 = Math.atan2(a[1] - cy, a[0] - cx);
  const n = Math.max(2, Math.ceil(Math.abs(theta) / (Math.PI / 24)));
  for (let i = 1; i < n; i++) out.push([cx + r * Math.cos(a0 + (theta * i) / n), cy + r * Math.sin(a0 + (theta * i) / n)]);
}

function expandBulges(verts, closed) {
  const out = [];
  const n = verts.length;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) bulgeArc(verts[i].p, verts[(i + 1) % n].p, verts[i].b, out);
  if (!closed) out.push(verts[n - 1].p);
  return out;
}

export function parseDXF(input) {
  const raw = typeof input === 'string' ? input : null;
  const u8 = raw == null ? (input instanceof Uint8Array ? input : new Uint8Array(input)) : null;
  if (u8) {
    const head = new TextDecoder('latin1').decode(u8.subarray(0, 24));
    if (/^AC10\d\d/.test(head)) throw new UploadError(DWG_MESSAGE, 'DWG');
    if (/AutoCAD Binary DXF/.test(head)) throw new UploadError('That is a binary DXF. In your CAD software save an ASCII DXF and upload that.', 'BINARY_DXF');
  } else if (/^AC10\d\d/.test(raw)) throw new UploadError(DWG_MESSAGE, 'DWG');
  const text = raw != null ? raw : textOf(u8);
  const lines = text.split(/\r?\n/);
  if (lines.length < 10 || !/^\s*0\s*$/.test(lines[0] || '') && !/^\s*999\s*$/.test(lines[0] || '')) throw new UploadError('That file is not an ASCII DXF.', 'BAD_DXF');
  const pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([parseInt(lines[i], 10), lines[i + 1].trim()]);
  let units = null;
  let section = '';
  const ents = [];
  let cur = null;
  let polyline = null;
  for (let i = 0; i < pairs.length; i++) {
    const [c, v] = pairs[i];
    if (c === 0 && v === 'SECTION') { section = (pairs[i + 1] || [])[1] || ''; continue; }
    if (c === 0 && v === 'ENDSEC') { section = ''; continue; }
    if (section === 'HEADER' && c === 9 && v === '$INSUNITS') { const n = parseInt((pairs[i + 1] || [])[1], 10); units = INSUNITS[n] ?? null; }
    if (section !== 'ENTITIES') continue;
    if (c === 0) {
      cur = null;
      if (v === 'LWPOLYLINE') { cur = { type: 'LWPOLYLINE', layer: '', closed: false, verts: [], pendingBulge: 0 }; ents.push(cur); }
      else if (v === 'POLYLINE') { cur = { type: 'POLYLINE', layer: '', closed: false, verts: [] }; ents.push(cur); polyline = cur; }
      else if (v === 'VERTEX' && polyline) { cur = { type: 'VERTEX', host: polyline, p: [NaN, NaN], b: 0 }; polyline.verts.push(cur); }
      else if (v === 'SEQEND') polyline = null;
      else if (v === 'LINE') { cur = { type: 'LINE', layer: '', a: [NaN, NaN], z: [NaN, NaN] }; ents.push(cur); }
      continue;
    }
    if (!cur) continue;
    const f = Number(v);
    if (cur.type === 'LWPOLYLINE') {
      if (c === 8) cur.layer = v;
      else if (c === 70) cur.closed = (parseInt(v, 10) & 1) === 1;
      else if (c === 10) cur.verts.push({ p: [f, NaN], b: 0 });
      else if (c === 20 && cur.verts.length) cur.verts[cur.verts.length - 1].p[1] = f;
      else if (c === 42 && cur.verts.length) cur.verts[cur.verts.length - 1].b = f;
    } else if (cur.type === 'POLYLINE') {
      if (c === 8) cur.layer = v;
      else if (c === 70) cur.closed = (parseInt(v, 10) & 1) === 1;
    } else if (cur.type === 'VERTEX') {
      if (c === 10) cur.p[0] = f;
      else if (c === 20) cur.p[1] = f;
      else if (c === 42) cur.b = f;
      else if (c === 70 && (parseInt(v, 10) & 16)) cur.skip = true; // spline frame control point
    } else if (cur.type === 'LINE') {
      if (c === 8) cur.layer = v;
      else if (c === 10) cur.a[0] = f;
      else if (c === 20) cur.a[1] = f;
      else if (c === 11) cur.z[0] = f;
      else if (c === 21) cur.z[1] = f;
    }
  }
  const warnings = [];
  const polygons = [];
  let open = 0;
  let curved = false;
  const lineEnts = [];
  for (const e of ents) {
    if (e.type === 'LINE') { if (finite(e.a) && finite(e.z)) lineEnts.push(e); continue; }
    const verts = e.type === 'POLYLINE' ? e.verts.filter((v) => !v.skip).map((v) => ({ p: v.p, b: v.b })) : e.verts;
    if (verts.length < 3) continue;
    if (!e.closed) {
      const a = verts[0].p;
      const z = verts[verts.length - 1].p;
      if (Math.hypot(a[0] - z[0], a[1] - z[1]) < 1e-6) e.closed = true;
      else { open += 1; continue; }
    }
    if (verts.some((v) => v.b)) curved = true;
    const p = mkPoly(`${e.layer || '0'} ${polygons.length + 1}`, expandBulges(verts, true), [], { layer: e.layer || '0' });
    if (valid(p)) polygons.push(p);
  }
  // Closed loops of LINE entities (end points within 1 mm of a drawing unit of 1) on the same layer.
  const byLayer = new Map();
  for (const l of lineEnts) (byLayer.get(l.layer) || byLayer.set(l.layer, []).get(l.layer)).push(l);
  for (const [layer, ls] of byLayer) {
    const tol = 1e-3;
    const used = new Set();
    const same = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= tol;
    for (let i = 0; i < ls.length; i++) {
      if (used.has(i)) continue;
      const chain = [ls[i].a, ls[i].z];
      used.add(i);
      let grew = true;
      while (grew) {
        grew = false;
        const end = chain[chain.length - 1];
        for (let j = 0; j < ls.length; j++) {
          if (used.has(j)) continue;
          if (same(ls[j].a, end)) { chain.push(ls[j].z); used.add(j); grew = true; break; }
          if (same(ls[j].z, end)) { chain.push(ls[j].a); used.add(j); grew = true; break; }
        }
      }
      if (chain.length >= 4 && same(chain[0], chain[chain.length - 1])) {
        const p = mkPoly(`${layer || '0'} lines ${polygons.length + 1}`, chain, [], { layer: layer || '0' });
        if (valid(p)) polygons.push(p);
      } else if (chain.length > 2) open += 1;
    }
  }
  if (open) warnings.push(`${open} open outline${open > 1 ? 's' : ''} in the drawing ${open > 1 ? 'were' : 'was'} skipped. Close the boundary as a closed polyline and try again.`);
  if (curved) warnings.push('Curved segments were converted to short straight segments.');
  if (!units) warnings.push('The drawing does not state its units. Choose metres, millimetres or feet below.');
  return { format: 'DXF', polygons, coordKind: 'xy', crs: null, needsCrs: true, units, warnings };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// CSV and pasted coordinates

const splitRow = (line) => line.trim().split(/[,;\t]+|\s{1,}/).map((s) => s.trim()).filter((s) => s !== '');
const HEAD = {
  lat: /^(lat|latitude|y_?lat)$/i, lon: /^(lon|lng|long|longitude|x_?lon)$/i,
  e: /^(e|east|easting|eastings|x)$/i, n: /^(n|north|northing|northings|y)$/i,
};

/**
 * Pasted or CSV points. `order`: 'auto' (default), 'latlon', 'lonlat' or 'en' (east then north), used when there is no header.
 * Returns the standard shape with one polygon; coordKind 'lonlat' when the numbers read as degrees, else 'xy' (needs a coordinate system).
 */
export function parseCoordinateText(input, { order = 'auto' } = {}) {
  const text = typeof input === 'string' ? input : textOf(input);
  const rows = text.split(/\r?\n/).map((l) => l.replace(/#.*$/, '').trim()).filter(Boolean);
  if (!rows.length) throw new UploadError('There are no coordinates to read. Paste one point per line.', 'EMPTY');
  let cols = null;
  let first = splitRow(rows[0]);
  const warnings = [];
  if (first.some((t) => !Number.isFinite(Number(t)))) {
    const names = first;
    cols = { lat: names.findIndex((t) => HEAD.lat.test(t)), lon: names.findIndex((t) => HEAD.lon.test(t)), e: names.findIndex((t) => /^(e|east|easting|eastings)$/i.test(t)), n: names.findIndex((t) => /^(n|north|northing|northings)$/i.test(t)), x: names.findIndex((t) => /^x$/i.test(t)), y: names.findIndex((t) => /^y$/i.test(t)) };
    rows.shift();
  }
  const pts = [];
  rows.forEach((l, i) => {
    const t = splitRow(l);
    const nums = t.map(Number);
    let a;
    let b;
    let hint = null;
    if (cols && cols.lat >= 0 && cols.lon >= 0) { a = nums[cols.lon]; b = nums[cols.lat]; hint = 'lonlat'; }
    else if (cols && cols.e >= 0 && cols.n >= 0) { a = nums[cols.e]; b = nums[cols.n]; hint = 'en'; }
    else if (cols && cols.x >= 0 && cols.y >= 0) { a = nums[cols.x]; b = nums[cols.y]; hint = 'en'; }
    else {
      let vals = t.slice();
      // A leading label or point number (1, 2, 3...) before the two coordinates is ignored.
      if (vals.length >= 3 && !Number.isFinite(Number(vals[0]))) vals = vals.slice(1);
      else if (vals.length >= 3 && Number.isInteger(Number(vals[0])) && Number(vals[0]) === i + 1) vals = vals.slice(1);
      a = Number(vals[0]);
      b = Number(vals[1]);
    }
    if (!Number.isFinite(a) || !Number.isFinite(b)) { warnings.push(`Line ${i + 1} was skipped, it needs two numbers.`); return; }
    pts.push({ a, b, hint });
  });
  if (pts.length < 3) throw new UploadError('A boundary needs at least three points.', 'TOO_FEW');
  const hint = pts[0].hint;
  let kind;
  let ring;
  if (hint === 'en') { kind = 'xy'; ring = pts.map((p) => [p.a, p.b]); }
  else if (hint === 'lonlat') { kind = 'lonlat'; ring = pts.map((p) => [p.a, p.b]); }
  else if (pts.every((p) => Math.abs(p.a) <= 180 && Math.abs(p.b) <= 180) && order !== 'en') {
    kind = 'lonlat';
    let o = order;
    if (o === 'auto') o = 'latlon';
    // A value over 90 can only be a longitude: take that column as longitude.
    const aBig = pts.some((p) => Math.abs(p.a) > 90);
    const bBig = pts.some((p) => Math.abs(p.b) > 90);
    if (aBig && !bBig) o = 'lonlat';
    else if (bBig && !aBig) o = 'latlon';
    ring = pts.map((p) => (o === 'lonlat' ? [p.a, p.b] : [p.b, p.a]));
    if (order === 'auto' && !aBig && !bBig) warnings.push('Both numbers can be a latitude, so the first was read as latitude and the second as longitude. Check the outline on the map.');
  } else {
    kind = 'xy';
    ring = pts.map((p) => [p.a, p.b]);
    // Easting is 6 digits and northing 7 digits for the usual southern zones: swap when they were typed the other way round.
    if (order === 'auto' && ring.every((q) => q[0] > 1e6 && q[1] < 1e6)) { ring = ring.map((q) => [q[1], q[0]]); warnings.push('The first number was larger than the second, so the columns were read as northing then easting.'); }
  }
  const p = mkPoly('Pasted boundary', ring);
  if (!valid(p)) throw new UploadError('Those points do not make an area. Check that they go around the boundary.', 'NO_AREA');
  return { format: 'Coordinates', polygons: [p], coordKind: kind, crs: kind === 'lonlat' ? WGS84_ID : null, needsCrs: kind === 'xy', warnings };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Choosing the reader for a file

const ext = (n) => String(n || '').toLowerCase().replace(/^.*\./, '');

/**
 * readUpload(files) -> parsed result. `files` is an array of { name, bytes } (Uint8Array or ArrayBuffer). A loose shapefile arrives as
 * several files (.shp, .dbf, .prj).
 */
export function readUpload(files) {
  const list = (files || []).map((f) => ({ name: String(f.name || ''), bytes: f.bytes instanceof Uint8Array ? f.bytes : new Uint8Array(f.bytes) }));
  if (!list.length) throw new UploadError('Choose a file first.', 'NO_FILE');
  const shp = list.find((f) => ext(f.name) === 'shp');
  if (shp) {
    const base = shp.name.replace(/\.shp$/i, '').toLowerCase();
    const sib = (e) => list.find((f) => f.name.toLowerCase() === `${base}.${e}`) || list.find((f) => ext(f.name) === e);
    return parseShapefile({ shp: shp.bytes, dbf: sib('dbf')?.bytes || null, prj: sib('prj')?.bytes || null, name: base });
  }
  const f = list[0];
  const e = ext(f.name);
  if (e === 'dwg') throw new UploadError(DWG_MESSAGE, 'DWG');
  if (e === 'kml') return parseKML(f.bytes);
  if (e === 'kmz') return parseKMZ(f.bytes);
  if (e === 'geojson' || e === 'json') return parseGeoJSON(f.bytes);
  if (e === 'zip') return parseShapefileZip(f.bytes);
  if (e === 'dxf') return parseDXF(f.bytes);
  if (e === 'csv' || e === 'txt' || e === 'xyz' || e === 'pts') return parseCoordinateText(f.bytes);
  if (e === 'dbf' || e === 'prj' || e === 'shx') throw new UploadError('Choose the .shp file as well. A shapefile needs the .shp, .dbf and .prj files together, or one zip of them.', 'NEED_SHP');
  // Unknown extension: sniff.
  const head = textOf(f.bytes.subarray(0, 400));
  if (/^\s*[\[{]/.test(head)) return parseGeoJSON(f.bytes);
  if (/<kml|<Placemark/i.test(head)) return parseKML(f.bytes);
  if (f.bytes[0] === 0x50 && f.bytes[1] === 0x4b) return parseKMZ(f.bytes);
  throw new UploadError('That file type is not supported. Use KML, KMZ, GeoJSON, a zipped shapefile, DXF or CSV, or paste the coordinates.', 'UNSUPPORTED');
}
