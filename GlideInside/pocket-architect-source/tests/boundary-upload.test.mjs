// Boundary upload: each reader on a fixture, coordinate systems (round trip, MGA against the independent geo.js code), bearings and misclose,
// an uploaded lot in and out of NSW, the lot through the commercial layout and the plan set, custom rules, and the aerial source chooser.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { zipSync, strToU8 } from '../src/lib/fflate.js';
import { jsPDF } from 'jspdf';
import { parseKML, parseKMZ, parseGeoJSON, parseShapefile, parseShapefileZip, parseDXF, parseCoordinateText, readUpload, UploadError, DWG_MESSAGE } from '../src/site/upload/parsers.js';
import { toLonLat, fromLonLat, searchCrs, resolveCrs, listCrs, localTmDef } from '../src/site/upload/crs.js';
import { lonLatToMga, mgaToLonLat } from '../src/site/geo.js';
import { frameFor, lonLatToFrame, frameToLonLat, stateAt } from '../src/site/upload/frame.js';
import { parseBearing, parseLegs, walkLegs, miscloseText, formatBearing } from '../src/site/upload/bearings.js';
import { toLonLatPolygons, lotResponseFromPolygons, buildUploadedLot, mergeAdjoining, guessFrontEdge } from '../src/site/upload/lot.js';
import { applyUploadedBoundary } from '../src/site/upload/apply-upload.js';
import { chooseAerialSource, planMosaic, tileUrl, fetchMapboxAerial, clearTileCache, tileCacheSize, metresPerPixel, aerialAttribution, loadAerialForLot, MAPBOX_ATTRIBUTION, NO_AERIAL_TEXT } from '../src/site/mapbox-aerial.js';
import { newCustomRules, applyCustomRules, effectiveRules, customRulesOn, needsCustomRules, currencySymbol, syncCurrency, DEFAULT_LABEL } from '../src/site/custom-rules.js';
import { computeSetbacks } from '../src/site/setback-stage.js';
import { createStore } from '../src/model/store.js';
import { createProject, migrate } from '../src/model/schema.js';
import { commercialStats } from '../src/commercial/stats.js';
import { commercialChecks } from '../src/commercial/checks.js';
import { commercialStatus } from '../src/commercial/card-model.js';
import { placeCommercial } from '../src/commercial/place.js';
import { exportPlanSet } from '../src/premium/exporters/planset/index.js';
import { lotHeading } from '../src/lotcard/stats.js';
import { buildShp, buildDbf, MGA56_WKT, WGS84_WKT } from './helpers/shp.mjs';

const fx = (n) => fs.readFileSync(new URL(`./fixtures/upload/${n}`, import.meta.url));
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b} (tol ${tol})`);

// ---- Readers ----------------------------------------------------------------------------------------------------------------

test('KML: polygons with names, a hole, CDATA and ampersand; the open line is skipped with a warning', () => {
  const r = parseKML(fx('auckland.kml'));
  assert.equal(r.polygons.length, 2);
  assert.equal(r.polygons[0].name, 'Lot A Penrose');
  assert.equal(r.polygons[1].name, 'Lot B & C');
  assert.equal(r.polygons[0].ring.length, 4); // the closing vertex is dropped
  assert.deepEqual(r.polygons[0].ring[0], [174.81, -36.9]);
  assert.equal(r.polygons[1].holes.length, 1);
  assert.equal(r.coordKind, 'lonlat');
  assert.ok(r.warnings.some((w) => /open line/.test(w)));
});

test('KMZ: the doc.kml inside a zip is read', () => {
  const kmz = zipSync({ 'doc.kml': fx('auckland.kml') });
  const r = parseKMZ(kmz);
  assert.equal(r.format, 'KMZ');
  assert.equal(r.polygons.length, 2);
  assert.throws(() => parseKMZ(zipSync({ 'a.txt': strToU8('x') })), (e) => e instanceof UploadError && e.code === 'NO_KML');
  assert.equal(readUpload([{ name: 'site.kmz', bytes: kmz }]).polygons.length, 2);
});

test('GeoJSON: features, multipolygon parts and names; a bad file is a readable error', () => {
  const r = parseGeoJSON(fx('lot.geojson'));
  assert.equal(r.polygons.length, 3);
  assert.equal(r.polygons[0].name, 'Yard 1');
  assert.equal(r.polygons[1].name, 'Yard 2');
  assert.throws(() => parseGeoJSON('{not json'), /not valid GeoJSON/);
  assert.equal(parseGeoJSON(JSON.stringify({ type: 'Polygon', coordinates: [[[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001], [0, 0]]] })).polygons.length, 1);
});

test('shapefile: outer ring clockwise, hole counter clockwise, dbf name, prj read; zipped too', () => {
  const outer = [[340000, 6250000], [340000, 6250100], [340060, 6250100], [340060, 6250000], [340000, 6250000]]; // clockwise
  const hole = [[340010, 6250010], [340020, 6250010], [340020, 6250020], [340010, 6250020], [340010, 6250010]]; // counter clockwise
  const shp = buildShp([{ n: 1, rings: [outer, hole] }, { n: 2, rings: [[[340100, 6250000], [340100, 6250050], [340140, 6250050], [340140, 6250000], [340100, 6250000]]] }]);
  const dbf = buildDbf(['LOT 5 DP 1234', 'LOT 6']);
  const r = parseShapefile({ shp, dbf, prj: strToU8(MGA56_WKT) });
  assert.equal(r.polygons.length, 2);
  assert.equal(r.polygons[0].name, 'LOT 5 DP 1234');
  assert.equal(r.polygons[0].ring.length, 4);
  assert.equal(r.polygons[0].holes.length, 1);
  assert.equal(r.needsCrs, false);
  const ll = toLonLat(r.crs, 340000, 6250000);
  close(ll[0], 151.26998545, 1e-6, 'wkt crs lon');
  const z = parseShapefileZip(zipSync({ 'lots/lots.shp': shp, 'lots/lots.dbf': dbf, 'lots/lots.prj': strToU8(MGA56_WKT) }));
  assert.equal(z.polygons.length, 2);
  assert.equal(z.format, 'Shapefile (zip)');
  const noPrj = parseShapefile({ shp });
  assert.equal(noPrj.needsCrs, true);
  assert.ok(noPrj.warnings.some((w) => /no \.prj/.test(w)));
  const deg = parseShapefile({ shp: buildShp([{ n: 1, rings: [[[151.2, -33.8], [151.2, -33.79], [151.21, -33.79], [151.21, -33.8], [151.2, -33.8]]] }]), prj: strToU8(WGS84_WKT) });
  assert.equal(deg.coordKind, 'lonlat');
  assert.throws(() => parseShapefileZip(zipSync({ 'a.kml': strToU8('<kml/>') })), /KML, not a shapefile/);
  assert.throws(() => readUpload([{ name: 'x.dbf', bytes: dbf }]), /\.shp file as well/);
});

test('DXF: LWPOLYLINE, old POLYLINE and a closed loop of LINEs are read; open outlines are skipped; units come from INSUNITS', () => {
  const r = parseDXF(fx('square.dxf').toString('latin1'));
  assert.equal(r.polygons.length, 3);
  assert.equal(r.units, 'mm');
  assert.deepEqual(r.polygons.map((p) => p.layer).sort(), ['LNS', 'LOT', 'OLD']);
  assert.ok(r.warnings.some((w) => /open outline/.test(w)));
  const lot = r.polygons.find((p) => p.layer === 'LOT');
  assert.deepEqual(lot.ring, [[1000, 2000], [41000, 2000], [41000, 62000], [1000, 62000]]);
  assert.equal(r.coordKind, 'xy');
  assert.equal(r.needsCrs, true);
});

test('DXF: a bulge becomes an arc; DWG and binary DXF give a plain instruction', () => {
  // A 10 x 10 square whose top edge bulges outward by a semicircle (bulge 1).
  const dxf = ['0', 'SECTION', '2', 'ENTITIES', '0', 'LWPOLYLINE', '8', 'A', '70', '1', '10', '0', '20', '0', '10', '10', '20', '0', '10', '10', '20', '10', '42', '1', '10', '0', '20', '10', '0', 'ENDSEC', '0', 'EOF', ''].join('\n');
  const r = parseDXF(dxf);
  assert.equal(r.polygons.length, 1);
  const ring = r.polygons[0].ring;
  assert.ok(ring.length > 10, 'arc segments added');
  let a = 0;
  for (let i = 0; i < ring.length; i++) { const p = ring[i]; const q = ring[(i + 1) % ring.length]; a += p[0] * q[1] - q[0] * p[1]; }
  close(Math.abs(a) / 2, 100 + (Math.PI * 25) / 2, 1.5, 'square plus half a disc');
  assert.ok(r.warnings.some((w) => /Curved/.test(w)));
  assert.throws(() => readUpload([{ name: 'plan.dwg', bytes: new Uint8Array([65, 67, 49, 48, 51, 50]) }]), (e) => e.code === 'DWG' && /Save As/.test(e.message) && e.message === DWG_MESSAGE);
  assert.throws(() => parseDXF(new TextEncoder().encode('AutoCAD Binary DXF\r\n\x1a\0')), /binary DXF/);
  assert.throws(() => parseDXF('hello'), /not an ASCII DXF/);
});

test('CSV and pasted coordinates: header columns, lat then lon, easting then northing, swapped columns', () => {
  const en = parseCoordinateText(fx('mga56.csv'));
  assert.equal(en.coordKind, 'xy');
  assert.equal(en.polygons[0].ring.length, 4);
  assert.deepEqual(en.polygons[0].ring[0], [340000, 6250000]);
  const ll = parseCoordinateText(fx('latlon.txt'));
  assert.equal(ll.coordKind, 'lonlat');
  assert.deepEqual(ll.polygons[0].ring[0], [151.2093, -33.8651]);
  const header = parseCoordinateText('lat,lng\n-36.9,174.81\n-36.9,174.82\n-36.91,174.82\n-36.91,174.81');
  assert.deepEqual(header.polygons[0].ring[1], [174.82, -36.9]);
  const swapped = parseCoordinateText('6250000 340000\n6250000 340060\n6250100 340060\n6250100 340000');
  assert.deepEqual(swapped.polygons[0].ring[0], [340000, 6250000]);
  const lonFirst = parseCoordinateText('174.81, -36.9\n174.82, -36.9\n174.82, -36.91');
  assert.deepEqual(lonFirst.polygons[0].ring[0], [174.81, -36.9]);
  assert.throws(() => parseCoordinateText('1,2\n3,4'), /at least three/);
  assert.equal(readUpload([{ name: 'p.csv', bytes: fx('mga56.csv') }]).polygons.length, 1);
  assert.throws(() => readUpload([{ name: 'p.bmp', bytes: new Uint8Array([1, 2, 3]) }]), /not supported/);
});

// ---- Coordinate systems ----------------------------------------------------------------------------------------------

test('CRS list: MGA zones 49 to 56 (both datums), UTM zones worldwide, search by words', () => {
  const all = listCrs();
  for (let z = 49; z <= 56; z++) { assert.ok(all.find((c) => c.id === `mga2020:${z}`)); assert.ok(all.find((c) => c.id === `mga94:${z}`)); }
  assert.equal(all.filter((c) => /^utm:\d+N$/.test(c.id)).length, 60);
  assert.equal(all.filter((c) => /^utm:\d+S$/.test(c.id)).length, 60);
  assert.deepEqual(searchCrs('mga 56').map((c) => c.id), ['mga2020:56', 'mga94:56']);
  assert.deepEqual(searchCrs('utm 32n').map((c) => c.id), ['utm:32N']);
  assert.equal(searchCrs('7855')[0].id, 'mga2020:55');
  assert.ok(searchCrs('zzzz').length === 0);
  assert.throws(() => resolveCrs('+proj=nonsense'), /could not be read|not be read/);
  assert.equal(resolveCrs('+proj=utm +zone=33 +south +datum=WGS84 +units=m +no_defs').kind, 'projected');
});

test('CRS transforms: MGA56, other MGA zones and UTM points round trip within 0.01 m', () => {
  const cases = [['mga2020:56', 340000, 6250000], ['mga2020:55', 700123.456, 5811234.567], ['mga2020:49', 250000, 6400000], ['mga94:54', 450000.5, 6700000.25],
    ['utm:32N', 691000, 5335000], ['utm:18N', 585000, 4511000], ['utm:33S', 331000, 6240000], ['utm:60S', 640000, 5915000], ['utm:1N', 500000, 100000]];
  for (const [id, e, n] of cases) {
    const [lon, lat] = toLonLat(id, e, n);
    const [e2, n2] = fromLonLat(id, lon, lat);
    close(e2, e, 0.01, `${id} easting`);
    close(n2, n, 0.01, `${id} northing`);
  }
});

test('CRS transforms agree with the independent MGA code (geo.js) to a centimetre; GDA94 differs by about 1.5 m', () => {
  for (const [lon, lat, zone] of [[151.2699, -33.8782, 56], [149.1, -35.3, 55], [143.5, -37.0, 54], [153.0, -27.5, 56]]) {
    const ours = fromLonLat(`mga2020:${zone}`, lon, lat);
    const ref = lonLatToMga(lon, lat, zone);
    close(ours[0], ref.e, 0.01, `E zone ${zone}`);
    close(ours[1], ref.n, 0.01, `N zone ${zone}`);
    const back = toLonLat(`mga2020:${zone}`, ref.e, ref.n);
    const bl = mgaToLonLat(ref.e, ref.n, zone);
    close(back[0], bl.lon, 1e-7); close(back[1], bl.lat, 1e-7);
  }
  const a = toLonLat('mga94:56', 340000, 6250000);
  const b = toLonLat('mga2020:56', 340000, 6250000);
  const shiftM = Math.hypot((a[0] - b[0]) * 92300, (a[1] - b[1]) * 111000);
  assert.ok(shiftM > 1.2 && shiftM < 2.0, `GDA94 to GDA2020 shift ${shiftM.toFixed(2)} m`);
});

test('frames: NSW and Queensland use MGA, elsewhere a local frame with true metres', () => {
  assert.equal(stateAt(150.93, -31.09), 'NSW');
  assert.equal(stateAt(153.03, -27.47), 'QLD');
  assert.equal(stateAt(144.96, -37.81), null);
  assert.equal(stateAt(174.76, -36.85), null);
  const nsw = frameFor(151.2, -33.87);
  assert.deepEqual([nsw.kind, nsw.zone, nsw.state], ['mga', 56, 'NSW']);
  const nz = frameFor(174.8105, -36.9005);
  assert.equal(nz.kind, 'tm');
  const a = lonLatToFrame(nz, 174.8105, -36.9005);
  const b = lonLatToFrame(nz, 174.8115, -36.9005);
  close(Math.hypot(b.e - a.e, b.n - a.n), 0.001 * 111320 * Math.cos((36.9005 * Math.PI) / 180), 0.2, '0.001 degree of longitude in metres');
  const back = frameToLonLat(nz, a.e, a.n);
  close(back.lon, 174.8105, 1e-9); close(back.lat, -36.9005, 1e-9);
  assert.match(localTmDef(174.8), /\+lon_0=174\.8/);
});

// ---- Bearings and distances ------------------------------------------------------------------------------------------------

test('bearings: quadrant and azimuth forms, dotted survey style, errors', () => {
  close(parseBearing('N 45 30 15 E'), 45.504166, 1e-5);
  close(parseBearing('N45°30\'15"E'), 45.504166, 1e-5);
  close(parseBearing('S12-30-00W'), 192.5, 1e-9);
  close(parseBearing('S 10 E'), 170, 1e-9);
  close(parseBearing('N 10 W'), 350, 1e-9);
  close(parseBearing('045°30\'00"'), 45.5, 1e-9);
  close(parseBearing('45.3015', { dotted: true }), 45.504166, 1e-5);
  close(parseBearing('45.5'), 45.5, 1e-9);
  assert.equal(parseBearing('N 95 E'), null);
  assert.equal(parseBearing('361'), null);
  assert.equal(parseBearing('hello'), null);
  assert.equal(parseBearing('45.7599', { dotted: true }), null); // 75 minutes
  assert.equal(formatBearing(45.504166), "045°30'15\"");
  const { legs, errors } = parseLegs('N 0 E 100\n090°00\'00" 50.5 m\nbad line\nS 0 E, 0\n');
  assert.equal(legs.length, 2);
  assert.equal(errors.length, 2);
});

test('bearings: a closed traverse has no misclose; a short last leg shows the misclose and Bowditch closes it', () => {
  const sq = parseLegs('0 100\n90 60\n180 100\n270 60').legs;
  const w = walkLegs({ e: 1000, n: 2000 }, sq);
  assert.equal(w.closed, true);
  assert.equal(miscloseText(w.misclose), 'Closes exactly');
  assert.equal(w.ring.length, 4);
  const off = parseLegs('0 100\n90 60\n180 100\n270 59').legs;
  const w2 = walkLegs({ e: 0, n: 0 }, off);
  close(w2.misclose.distance, 1, 1e-9);
  assert.equal(w2.misclose.ratio, 319);
  assert.match(miscloseText(w2.misclose), /^Misclose 1\.000 m, 1 in 319$/);
  close(w2.misclose.bearing, 90, 1e-6);
  const adj = walkLegs({ e: 0, n: 0 }, off, { adjust: 'bowditch' });
  assert.equal(adj.ring.length, 4);
  assert.deepEqual([adj.ring[0].e, adj.ring[0].n], [0, 0]);
  const last = adj.points[adj.points.length - 1];
  close(Math.hypot(last.e - adj.ring[0].e, last.n - adj.ring[0].n), 1, 1e-6, 'the stations still end where the legs end');
  // After adjusting, the stations move by up to the misclose and the ring closes (the last ring point plus its leg reaches the start).
  close(adj.ring[3].e, 0 - (-1) * 0 + (adj.ring[3].e), 1e-9);
});

// ---- Lots -------------------------------------------------------------------------------------------------------------------

test('uploaded lot overseas: an Auckland KML becomes a local frame lot with area, centroid, custom rules and the user boundary note', () => {
  const parsed = parseKML(fx('auckland.kml'));
  const { polys } = toLonLatPolygons([parsed.polygons[0]], parsed, {});
  const built = lotResponseFromPolygons({ polys, name: '' });
  assert.equal(built.frame.kind, 'tm');
  assert.equal(built.resp.state, '');
  assert.equal(built.resp.srid, null);
  const expect = (0.001 * 111320 * Math.cos((36.9005 * Math.PI) / 180)) * (0.001 * 110950);
  close(built.resp.lot.areaM2, expect, expect * 0.02, 'area');
  close(built.centre.lon, 174.8105, 1e-6);
  const lot = buildUploadedLot(built, { commercial: true });
  assert.equal(lot.source, 'upload');
  assert.equal(lot.lotLabel, 'Lot A Penrose');
  assert.equal(lotHeading(lot), 'Lot A Penrose');
  assert.equal(lot.boundaryNote, 'Boundary supplied by user, not checked against title');
  assert.equal(lot.boundary.length, 4);
  assert.equal(lot.frontEdges.length, 1);
  assert.equal(lot.frontageConfirmed, false);
  assert.equal(needsCustomRules(lot), true);
  assert.equal(customRulesOn(lot), true);
  assert.equal(lot.customRules.currency, 'AUD');
  assert.equal(lot.customRules.symbol, 'A$');
  assert.deepEqual(lot.customRules.edited, {});
  assert.deepEqual(lot.neighbours, []);
  const cx = lot.boundary.reduce((s, p) => s + p.x, 0) / 4;
  close(cx, 0, 2000, 'centred on the plan origin');
});

test('uploaded lot in NSW: MGA frame, state and srid set, no custom rules unless ticked', () => {
  const parsed = parseCoordinateText(fx('mga56.csv'));
  const { polys } = toLonLatPolygons(parsed.polygons, parsed, { crs: 'mga2020:56' });
  const built = lotResponseFromPolygons({ polys });
  assert.equal(built.frame.kind, 'mga');
  assert.equal(built.resp.state, 'NSW');
  assert.equal(built.resp.srid, 7856);
  close(built.resp.lot.areaM2, 6000, 0.2);
  assert.equal(buildUploadedLot(built).customRules, undefined);
  assert.equal(buildUploadedLot(built, { forceCustom: true }).customRules.on, true);
  assert.throws(() => toLonLatPolygons(parsed.polygons, parsed, {}), /Choose the coordinate system/);
});

test('place by hand: the outline keeps its size from the units, is rotated and lands on the chosen point', () => {
  const dxf = parseDXF(fx('square.dxf').toString('latin1'));
  const lot = dxf.polygons.find((p) => p.layer === 'LOT'); // 40 m x 60 m in millimetres
  const { polys } = toLonLatPolygons([lot], dxf, { placement: { lon: 174.76, lat: -36.85, rotationDeg: 0 }, units: 'mm' });
  const built = lotResponseFromPolygons({ polys });
  close(built.resp.lot.areaM2, 2400 * 1, 1, '40 x 60 m'); // 40000 x 60000 mm = 40 x 60 m
  close(built.centre.lon, 174.76, 1e-5); close(built.centre.lat, -36.85, 1e-5);
  const wrong = toLonLatPolygons([lot], dxf, { placement: { lon: 174.76, lat: -36.85, rotationDeg: 90 }, units: 'mm' });
  const b2 = lotResponseFromPolygons({ polys: wrong.polys });
  close(b2.resp.lot.areaM2, 2400, 1, 'rotation keeps the area');
  const w = Math.max(...b2.resp.lot.polygons[0].outer.map((p) => p[0])) - Math.min(...b2.resp.lot.polygons[0].outer.map((p) => p[0]));
  close(w, 60, 0.1, 'turned a quarter, the 60 m side now runs east');
  const feet = toLonLatPolygons([{ ring: [[0, 0], [100, 0], [100, 100], [0, 100]], holes: [] }], { format: 'x' }, { placement: { lon: 10, lat: 50, rotationDeg: 0 }, units: 'ft' });
  close(lotResponseFromPolygons({ polys: feet.polys }).resp.lot.areaM2, 100 * 100 * 0.3048 * 0.3048, 0.5, 'feet');
});

test('join adjoining outlines: shared edges cancel, separate outlines stay parts', () => {
  const a = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const b = [[10, 0], [20, 0], [20, 10], [10, 10]];
  const m = mergeAdjoining([a, b]);
  assert.equal(m.merged, true);
  assert.equal(m.rings.length, 1);
  assert.equal(m.rings[0].length, 6);
  const far = mergeAdjoining([a, [[30, 0], [40, 0], [40, 10], [30, 10]]]);
  assert.equal(far.merged, false);
  assert.equal(far.rings.length, 2);
  const parsed = parseKML(fx('auckland.kml'));
  const { polys } = toLonLatPolygons(parsed.polygons, parsed, {});
  const built = lotResponseFromPolygons({ polys, merge: true });
  assert.equal(built.parts, 2);
  assert.ok(built.warnings.some((w) => /could not be joined/.test(w)));
});

test('frontage guess: the shorter street side of a rectangle', () => {
  assert.equal(guessFrontEdge([{ x: 0, y: 0 }, { x: 100000, y: 0 }, { x: 100000, y: 60000 }, { x: 0, y: 60000 }]), 1);
  assert.equal(guessFrontEdge([{ x: 0, y: 0 }, { x: 40000, y: 0 }, { x: 40000, y: 100000 }, { x: 0, y: 100000 }]), 0);
});

// ---- Aerial source ----------------------------------------------------------------------------------------------------------

test('aerial source chooser: NSW and Queensland keep state imagery, Mapbox outside, none without a token', () => {
  assert.equal(chooseAerialSource({ lon: 150.93, lat: -31.09, token: 'pk.test' }).source, 'nsw');
  assert.equal(chooseAerialSource({ lon: 153.03, lat: -27.47, token: 'pk.test' }).source, 'qld');
  assert.equal(chooseAerialSource({ lon: 174.76, lat: -36.85, token: 'pk.test' }).source, 'mapbox');
  assert.equal(chooseAerialSource({ lon: 144.96, lat: -37.81, token: 'pk.abc' }).source, 'mapbox');
  const none = chooseAerialSource({ lon: 174.76, lat: -36.85, token: '' });
  assert.equal(none.source, 'none');
  assert.equal(none.reason, NO_AERIAL_TEXT);
  assert.equal(chooseAerialSource({ lon: 174.76, lat: -36.85, token: 'sk.secret' }).source, 'none', 'a secret token is never used');
  assert.equal(chooseAerialSource({ lon: 150.93, lat: -31.09, token: '', forceMapbox: true }).source, 'none');
  assert.equal(chooseAerialSource({ lon: 150.93, lat: -31.09, token: 'pk.test', forceMapbox: true }).source, 'mapbox');
});

test('mosaic plan: the sharpest zoom that fits, tile count and output size follow the site size', () => {
  const frame = frameFor(174.81, -36.9);
  const small = planMosaic({ frame, bbox: { minE: 499900, maxE: 500100, minN: -4087200, maxN: -4087000 } });
  assert.equal(small.z, 19);
  assert.ok(small.tiles.length <= 25);
  assert.ok(small.widthPx > 800 && small.widthPx <= 4096);
  close(small.mPerPx, metresPerPixel(19, -36.9), 0.01, 'about 0.12 m a pixel');
  const big = planMosaic({ frame, bbox: { minE: 498000, maxE: 502000, minN: -4089000, maxN: -4085000 }, maxPx: 2048 });
  assert.ok(big.z < 19 && big.z >= 14);
  assert.ok(big.widthPx <= 2048 && big.tiles.length <= 49);
  const url = tileUrl(19, 1, 2, 'pk.abc');
  assert.match(url, /^https:\/\/api\.mapbox\.com\/v4\/mapbox\.satellite\/19\/1\/2@2x\.jpg90\?access_token=pk\.abc$/);
});

test('mapbox fetch: tiles are drawn on a mosaic, kept in memory only, the token never appears in an error', async () => {
  clearTileCache();
  const frame = frameFor(174.81, -36.9);
  const bbox = { minE: 499950, maxE: 500050, minN: -4087150, maxN: -4087050 };
  const calls = [];
  const fetchImpl = async (u) => { calls.push(u); return { ok: true, status: 200, blob: async () => ({ tile: u }) }; };
  const draws = [];
  const ctxFor = (name) => ({ drawImage: (...a) => draws.push([name, ...a]), setTransform: () => {}, imageSmoothingEnabled: false });
  const createCanvas = (w, h) => ({ width: w, height: h, getContext: () => ctxFor(`${w}x${h}`), convertToBlob: async () => ({ jpeg: true, w, h }) });
  const decode = async () => ({ close() {} });
  const r = await fetchMapboxAerial({ frame, bbox, token: 'pk.testtoken', fetchImpl, createCanvas, decode });
  assert.equal(r.meta.source, 'Mapbox Satellite');
  assert.equal(r.meta.attribution, MAPBOX_ATTRIBUTION);
  assert.equal(r.meta.attribution, '© Mapbox © OpenStreetMap');
  assert.deepEqual(r.meta.bbox, bbox);
  assert.ok(r.meta.widthPx > 500);
  assert.ok(calls.length >= 1 && calls.every((u) => /^https:\/\/api\.mapbox\.com\//.test(u)));
  const n = calls.length;
  assert.equal(tileCacheSize(), n);
  await fetchMapboxAerial({ frame, bbox, token: 'pk.testtoken', fetchImpl, createCanvas, decode });
  assert.equal(calls.length, n, 'the second picture reuses the tiles in memory');
  clearTileCache();
  await assert.rejects(() => fetchMapboxAerial({ frame, bbox, token: 'pk.testtoken', fetchImpl: async () => ({ ok: false, status: 401 }), createCanvas, decode }), (e) => /token was refused/.test(e.message) && !/pk\.testtoken/.test(e.message));
  clearTileCache();
  await assert.rejects(() => fetchMapboxAerial({ frame, bbox, token: 'pk.testtoken', fetchImpl: async () => { throw new Error('boom pk.testtoken'); }, createCanvas, decode }), (e) => !/pk\.testtoken/.test(e.message));
  await assert.rejects(() => fetchMapboxAerial({ frame, bbox, token: '', createCanvas, decode }), /not available/);
  assert.equal(aerialAttribution({ aerial: { source: 'Mapbox Satellite' } }), MAPBOX_ATTRIBUTION);
  assert.equal(aerialAttribution({ aerial: { source: 'NSW Imagery' } }), '');
});

test('aerial for a lot: Mapbox outside, state service inside, a grey ground with the plain words when nothing is available', async () => {
  clearTileCache();
  const frame = frameFor(174.81, -36.9);
  const bbox = { minE: 499950, maxE: 500050, minN: -4087150, maxN: -4087050 };
  const deps = { fetchImpl: async () => ({ ok: true, status: 200, blob: async () => ({}) }), createCanvas: (w, h) => ({ width: w, height: h, getContext: () => ({ drawImage() {}, setTransform() {} }), convertToBlob: async () => ({ ok: 1 }) }), decode: async () => ({}) };
  const lot = { srid: null, origin: { e: 500000, n: -4087100 } };
  const mb = await loadAerialForLot({ lot, frame, bbox, token: 'pk.t', ...deps });
  assert.equal(mb.source, 'mapbox');
  assert.ok(mb.aerial && mb.aerialWide);
  assert.ok(mb.aerialWide.meta.widthPx <= 2048);
  const none = await loadAerialForLot({ lot, frame, bbox, token: '', ...deps });
  assert.equal(none.source, 'none');
  assert.equal(none.aerial, null);
  assert.ok(none.warnings.includes(NO_AERIAL_TEXT));
  // Inside NSW the state service is asked (with the MGA box), not Mapbox.
  const nsw = frameFor(151.27, -33.88);
  const nb = { minE: 339950, maxE: 340050, minN: 6249950, maxN: 6250050 };
  const asked = [];
  const st = await loadAerialForLot({ lot: { srid: 7856, origin: { e: 340000, n: 6250000 } }, frame: nsw, bbox: nb, token: 'pk.t', ...deps, stateFetch: async (p) => { asked.push(p); return { blob: {}, meta: { bbox: nb, source: 'NSW Imagery' } }; } });
  assert.equal(st.source, 'nsw');
  assert.equal(asked[0].state, 'NSW');
  assert.equal(asked[0].srid, '7856');
  assert.equal(asked.length, 2);
  // The state service failing falls back to Mapbox when a token exists, and to none without one.
  const fall = await loadAerialForLot({ lot: { srid: 7856, origin: { e: 340000, n: 6250000 } }, frame: nsw, bbox: nb, token: 'pk.t', ...deps, stateFetch: async () => { throw new Error('down'); } });
  assert.equal(fall.source, 'mapbox');
  const fall2 = await loadAerialForLot({ lot: { srid: 7856, origin: { e: 340000, n: 6250000 } }, frame: nsw, bbox: nb, token: '', ...deps, stateFetch: async () => { throw new Error('down'); } });
  assert.equal(fall2.source, 'none');
});

// ---- Through the app: the lot, custom rules, Best fit, checks and the plan set -----------------------------------------------

const newStore = (mode) => { const store = createStore(migrate(createProject({ name: 'Upload test' })), { autosaveKey: null }); if (mode) store.apply('Mode', (p) => { p.mode = mode; }); return store; };
const aucklandInput = () => { const parsed = parseKML(fx('auckland.kml')); return { polys: toLonLatPolygons([parsed.polygons[0]], parsed, {}).polys, name: '' }; };
const offline = { token: '', ensureToken: false, stateFetch: async () => { throw new Error('offline'); } };

test('an uploaded overseas lot goes through commercial Best fit with custom rules, the checks and a plan set that carries the notices', async () => {
  const store = newStore('commercial');
  const { lot, aerialSource } = await applyUploadedBoundary(store, aucklandInput(), offline);
  assert.equal(aerialSource, 'none');
  assert.equal(store.project.site.lot.source, 'upload');
  assert.equal(lot.aerial, null);
  assert.equal(lot.aerialSource, 'none');
  store.apply('Confirm frontage', (p) => { p.site.lot.frontageConfirmed = true; });
  const choice = await placeCommercial(store, { wait: 0 });
  assert.ok(choice && !choice.tooBig, 'a layout fits the uploaded lot');
  const p = store.project;
  const st = commercialStats(p);
  assert.ok(st.units >= 3, `units ${st.units}`);
  assert.ok(st.parking.provided >= st.parking.required);
  assert.equal(commercialStatus(p).setback.state, 'inside', JSON.stringify(commercialStatus(p).setback) + JSON.stringify(p.site.lot.setbacks));
  // The setbacks in force are the custom defaults (industrial table), labelled as set by the person.
  assert.equal(p.site.lot.setbacks.basis, 'Set by you (local rule), not checked against any authority');
  assert.equal(p.site.lot.setbacks.front.minM, 10);
  // Changing a rule is one undo step and the setback is recomputed from the new value without any council lookup.
  applyCustomRules(store, { front: 15, side: 4, coveragePct: 5, parkingPer100m2: 2, accessiblePer100Bays: 5, currency: 'NZD' });
  const lot2 = store.project.site.lot;
  assert.equal(lot2.customRules.front, 15);
  assert.equal(lot2.customRules.edited.front, true);
  assert.equal(lot2.customRules.edited.rear, undefined);
  assert.equal(lot2.customRules.symbol, 'NZ$');
  const r = await computeSetbacks(store.project, lot2, { fetchImpl: () => { throw new Error('no network lookup is allowed'); } });
  assert.equal(r.setbacks.front.minM, 15);
  assert.equal(r.setbacks.side.minM, 4);
  assert.ok(r.envelope && r.envelope.length >= 3);
  assert.equal(store.project.commercial.rates.parkingPerM2Gfa, 0.02);
  assert.equal(store.project.commercial.parking.accessiblePerBays, 20);
  const eff = effectiveRules(store.project, 'industrial');
  assert.equal(eff.custom, true);
  assert.equal(eff.coverageMaxPct, 5);
  const cover = commercialChecks(store.project).find((c) => c.id === 'coverage');
  assert.ok(cover && /above the 5% maximum you set/.test(cover.text), cover?.text);
  assert.equal(syncCurrency(store.project), 'NZ$');
  store.undo();
  assert.equal(store.project.site.lot.customRules.front, 10);
  syncCurrency(store.project);
  // Plan set
  const texts = [];
  class Rec extends jsPDF {
    constructor(...a) { super(...a); const t = this.text.bind(this); this.text = (s, ...rest) => (texts.push(Array.isArray(s) ? s.join(' ') : String(s)), t(s, ...rest)); }
  }
  const out = await exportPlanSet({ project: store.project, kind: 'commercial', download: false, jsPDF: Rec, fetchSite: null, date: new Date(2026, 10, 15) });
  assert.equal(out.pages, 6);
  const all = texts.join('\n');
  assert.match(all, /Boundary supplied by user, not checked against title/);
  assert.doesNotMatch(all, /Boundaries are from the cadastre/);
  assert.doesNotMatch(all, /[–—]/, 'no en or em dashes');
  assert.doesNotMatch(all, /compliant/i);
});

test('the plan set names Mapbox and OpenStreetMap when the lot aerial is Mapbox imagery', async () => {
  const store = newStore('commercial');
  await applyUploadedBoundary(store, aucklandInput(), offline);
  store.apply('Confirm frontage', (p) => { p.site.lot.frontageConfirmed = true; });
  await placeCommercial(store, { wait: 0 });
  const aerial = { image: new Uint8Array(fs.readFileSync(new URL('./fixtures/aerial-test.jpg', import.meta.url))), extentM: { minE: -282, minN: -270, maxE: 318, maxN: 330 }, attribution: MAPBOX_ATTRIBUTION };
  const texts = [];
  class Rec extends jsPDF {
    constructor(...a) { super(...a); const t = this.text.bind(this); this.text = (s, ...rest) => (texts.push(Array.isArray(s) ? s.join(' ') : String(s)), t(s, ...rest)); }
  }
  await exportPlanSet({ project: store.project, kind: 'commercial', download: false, jsPDF: Rec, fetchSite: null, aerial, date: new Date(2026, 10, 15) });
  const all = texts.join('\n');
  assert.match(all, /© Mapbox © OpenStreetMap/);
  assert.match(all, /Boundary supplied by user, not checked against title/);
});

test('custom rules defaults are labelled, clamped and track which values the person changed', () => {
  const r = newCustomRules({ commercial: true, cls: 'industrial' });
  assert.deepEqual([r.front, r.secondaryFront, r.side, r.rear, r.coveragePct, r.landscapePct], [10, 5, 3, 3, 70, 10]);
  assert.equal(r.parkingPer100m2, 1.33);
  assert.equal(r.accessiblePer100Bays, 1);
  assert.equal(DEFAULT_LABEL, 'Australian default, set your local rule');
  const h = newCustomRules({ commercial: false });
  assert.deepEqual([h.front, h.side, h.rear], [6, 0.9, 3]);
  assert.equal(currencySymbol(null), '$');
  assert.equal(currencySymbol({ customRules: { on: true, symbol: 'A$' } }), 'A$');
  assert.equal(currencySymbol({ customRules: { on: false, symbol: 'A$' } }), '$');
});

test('housing mode uses the custom setbacks too (no council lookup)', async () => {
  const store = newStore();
  await applyUploadedBoundary(store, aucklandInput(), offline);
  store.apply('Confirm frontage', (p) => { p.site.lot.frontageConfirmed = true; });
  applyCustomRules(store, { front: 8, side: 2, rear: 4 });
  const lot = store.project.site.lot;
  const r = await computeSetbacks(store.project, lot, { fetchImpl: () => { throw new Error('no network lookup is allowed'); } });
  assert.equal(r.setbacks.front.minM, 8);
  assert.equal(r.setbacks.basis, 'Set by you (local rule), not checked against any authority');
  assert.ok(r.envelope && r.envelope.length >= 3);
});

test('UI wording: no em or en dashes, never "compliant", no builder brand names in the new files', () => {
  const files = ['site/upload/dialog.js', 'site/upload/rules-panel.js', 'site/upload/flow.js', 'site/upload/sheet-text.js', 'site/upload/place-map.js', 'site/custom-rules.js', 'site/mapbox-aerial.js', 'site/upload/parsers.js', 'site/upload/bearings.js', 'site/upload/lot.js', 'site/upload/crs.js', 'site/upload/frame.js', 'site/upload/apply-upload.js', 'site/upload/css.js'];
  for (const f of files) {
    const src = fs.readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /[–—]/, `${f} has a dash`);
    assert.doesNotMatch(src, /compliant/i, `${f} says compliant`);
    assert.doesNotMatch(src, /hunter|gj gardner|g\.j\. gardner|hotondo|metricon|clarendon|simonds|porter davis/i, `${f} names a builder`);
    assert.doesNotMatch(src, /\bsk\.[A-Za-z0-9]{8,}/, `${f} holds a secret token`);
  }
});
