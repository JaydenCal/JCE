// Site lookup: geometry, contours, project model, schema migration, fixtures and the 3D terrain.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import * as geo from '../src/site/geo.js';
import { contourLines, sampleGrid, levelsBetween, fillGaps } from '../src/site/contours.js';
import { buildSiteLot, boundaryEdges, floorRLOf, terrainAt, underlayFor, aerialExtentPlan } from '../src/site/model.js';
import { FIXTURES, mockSearch } from '../src/site/fixtures/index.js';
import { createProject, migrate, validate, SCHEMA_VERSION } from '../src/model/schema.js';
import { buildModel } from '../src/viewer3d/build.js';
import { terrainModel } from '../src/viewer3d/terrain.js';
import { recentreDesign } from '../src/site/apply.js';
import { layerOn } from '../src/editor2d/draw-site.js';
import { TEMPLATES } from '../src/catalogue/templates.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b}`);

// Geometry ------------------------------------------------------------------------------------------------------------
test('MGA zone from longitude', () => {
  assert.equal(geo.mgaZoneForLon(138), 54);
  assert.equal(geo.mgaZoneForLon(143.99), 54);
  assert.equal(geo.mgaZoneForLon(144), 55);
  assert.equal(geo.mgaZoneForLon(146.82), 55); // Townsville
  assert.equal(geo.mgaZoneForLon(150.93), 56); // Tamworth
  assert.equal(geo.mgaZoneForLon(153.02), 56); // Brisbane
  assert.throws(() => geo.mgaZoneForLon(137.9));
  assert.throws(() => geo.mgaZoneForLon(156));
  assert.equal(geo.mgaSrid(54), 7854);
  assert.equal(geo.mgaSrid(56), 7856);
  assert.equal(geo.zoneForSrid(7855), 55);
  assert.equal(geo.centralMeridian(55), 147);
});

test('transverse Mercator matches published GDA2020 / MGA values and round trips', () => {
  // The central meridian at the equator is the false origin, and k0 scales along it.
  const o = geo.lonLatToMga(147, 0, 55);
  near(o.e, 500000, 1e-6);
  near(o.n, 10000000, 1e-6);
  // Known: Sydney Town Hall area, 151.2093 E, 33.8688 S is about E 334,000, N 6,252,000 in zone 56 (published maps).
  const s = geo.lonLatToMga(151.2093, -33.8688, 56);
  assert.ok(s.e > 333000 && s.e < 336000, `easting ${s.e}`);
  assert.ok(s.n > 6250000 && s.n < 6254000, `northing ${s.n}`);
  for (const [lon, lat, z] of [[150.93, -31.09, 56], [146.82, -19.26, 55], [141.5, -27, 54], [153.4, -28.2, 56]]) {
    const p = geo.lonLatToMga(lon, lat, z);
    const back = geo.mgaToLonLat(p.e, p.n, z);
    near(back.lon, lon, 1e-9, 'lon');
    near(back.lat, lat, 1e-9, 'lat');
  }
  // One arc second of latitude is about 30.9 m on the grid (scale factor close to 0.9996 on the central meridian).
  const a = geo.lonLatToMga(147, -20, 55);
  const b = geo.lonLatToMga(147, -20 + 1 / 3600, 55);
  near(b.n - a.n, 30.751 * 0.9996, 0.02); // meridian arc at 20 S is 110.704 km per degree
});

test('web mercator round trip and box', () => {
  const w = geo.lonLatToWeb(150.93, -31.09);
  const g = geo.webToLonLat(w.x, w.y);
  near(g.lon, 150.93, 1e-9);
  near(g.lat, -31.09, 1e-9);
  const box = geo.mgaBoxToWebBox({ minE: 340000, minN: 6560000, maxE: 340100, maxN: 6560100 }, 56);
  assert.ok(box.maxX > box.minX && box.maxY > box.minY);
});

test('northing maps to -y and east to +x in plan millimetres', () => {
  const origin = { e: 340000, n: 6560000 };
  assert.deepEqual(geo.mgaToPlan(origin, 340010, 6560020), { x: 10000, y: -20000 }); // 20 m north is up the screen
  assert.deepEqual(geo.siteToPlan([1.5, -2]), { x: 1500, y: 2000 });
  const back = geo.planToMga(origin, { x: 10000, y: -20000 });
  assert.deepEqual(back, { e: 340010, n: 6560020 });
  assert.deepEqual(geo.planToSite({ x: 1500, y: 2000 }), [1.5, -2]);
});

test('polygon helpers: area, centroid, interior point, rings to polygons, edges', () => {
  const sq = [[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]]; // clockwise with y up, like an Esri outer ring
  near(geo.ringArea(sq), 100, 1e-9);
  assert.ok(geo.signedArea(sq) < 0);
  assert.deepEqual(geo.ringCentroid(sq).map((v) => Math.round(v * 1e6) / 1e6), [5, 5]);
  const L = [[0, 0], [0, 10], [4, 10], [4, 4], [10, 4], [10, 0]];
  const ip = geo.interiorPoint(L);
  assert.ok(geo.pointInRing(ip, L));
  const polys = geo.ringsToPolygons([sq, [[2, 2], [4, 2], [4, 4], [2, 4], [2, 2]]]);
  assert.equal(polys.length, 1);
  assert.equal(polys[0].holes.length, 1);
  near(geo.polygonArea(polys[0]), 96, 1e-9);
  const edges = geo.ringEdges(sq);
  assert.equal(edges.length, 4);
  assert.deepEqual(edges.map((e) => e.length), [10, 10, 10, 10]);
  near(geo.bearingDeg([0, 0], [10, 10]), 45, 1e-9);
  assert.equal(geo.formatPlan('DP1234'), 'DP 1234');
  assert.equal(geo.formatPlan('rp 12345'), 'RP 12345');
});

// Contours --------------------------------------------------------------------------------------------------------------
function coneGrid(cols = 21, rows = 21, cell = 1) {
  // A cone peaking at 5 m in the middle and falling 0.5 m per metre.
  const values = [];
  const x0 = -10;
  const y0 = 10;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) values.push(5 - 0.5 * Math.hypot(x0 + i * cell, y0 - j * cell));
  return { cols, rows, cell, x0, y0, values };
}

test('levels between min and max at an interval', () => {
  assert.deepEqual(levelsBetween(0.2, 2.1, 0.5), [0.5, 1, 1.5, 2]);
  assert.deepEqual(levelsBetween(1, 1, 0.5), [1]);
  assert.deepEqual(levelsBetween(0.1, 0.4, 0.5), []);
});

test('marching squares on a synthetic cone gives closed rings at the right radius', () => {
  const grid = coneGrid();
  const lines = contourLines(grid, { minor: 0.5, major: 2.5 });
  const at2 = lines.filter((l) => l.level === 2);
  assert.equal(at2.length, 1);
  assert.ok(at2[0].closed);
  // 5 - 0.5 r = 2 gives r = 6 m
  for (const p of at2[0].points) near(Math.hypot(p[0], p[1]), 6, 0.1, 'radius');
  const majors = lines.filter((l) => l.major).map((l) => l.level);
  assert.deepEqual([...new Set(majors)], [0, 2.5]);
  assert.ok(lines.filter((l) => l.level >= 1).every((l) => l.points.length >= 3));
});

test('marching squares on a plane gives straight open lines and handles flat grids', () => {
  const values = [];
  for (let j = 0; j < 6; j++) for (let i = 0; i < 6; i++) values.push(i * 0.25); // rises 0.25 m per metre eastwards
  const grid = { cols: 6, rows: 6, cell: 1, x0: 0, y0: 5, values };
  const lines = contourLines(grid, { minor: 0.5, major: 1 });
  const used = lines.filter((l) => l.level > 0);
  assert.deepEqual(used.map((l) => l.level), [0.5, 1]);
  for (const l of used) {
    assert.equal(l.closed, false);
    const xs = l.points.map((p) => p[0]);
    near(Math.min(...xs), l.level / 0.25, 1e-6);
    near(Math.max(...xs), l.level / 0.25, 1e-6);
  }
  assert.deepEqual(contourLines({ cols: 3, rows: 3, cell: 1, x0: 0, y0: 2, values: new Array(9).fill(3.2) }), []);
});

test('saddle cells do not cross lines; gaps fill from neighbours; sampling is bilinear', () => {
  const grid = { cols: 2, rows: 2, cell: 1, x0: 0, y0: 1, values: [1, 0, 0, 1] };
  const lines = contourLines(grid, { minor: 0.5, major: 1 }).filter((l) => l.level === 0.5);
  assert.equal(lines.length, 2); // two separate corner lines, not one crossing pair
  const g2 = { cols: 3, rows: 1, cell: 1, x0: 0, y0: 0, values: [1, null, 3] };
  fillGaps(g2);
  assert.equal(g2.values[1], 2);
  assert.throws(() => fillGaps({ cols: 1, rows: 1, cell: 1, x0: 0, y0: 0, values: [null] }));
  const c = coneGrid();
  near(sampleGrid(c, 0, 0), 5, 1e-9);
  near(sampleGrid(c, 0.5, 0), 4.75, 1e-9);
  assert.equal(sampleGrid(c, 11, 0), null);
});

// Fixtures and the project model ------------------------------------------------------------------------------------------
test('fixtures have the shapes the API returns', () => {
  assert.equal(FIXTURES.length, 2);
  const [nsw, qld] = FIXTURES;
  assert.equal(nsw.lot.state, 'NSW');
  assert.equal(nsw.lot.srid, 7856);
  assert.equal(qld.lot.state, 'QLD');
  assert.equal(qld.lot.srid, 7855);
  assert.equal(qld.lot.zoning, null);
  assert.ok(qld.lot.zoneNote);
  for (const f of FIXTURES) {
    assert.ok(f.lot.sample && f.aerial.sample && f.contours.sample);
    assert.ok(f.lot.lot.polygons[0].outer.length >= 4);
    assert.ok(f.lot.neighbours.length >= 8);
    assert.equal(f.contours.grid.values.length, f.contours.grid.cols * f.contours.grid.rows);
    assert.ok(f.contours.contours.length > 0);
    assert.ok(f.contours.provenance.note.includes('indicative only'));
    assert.ok(f.aerial.mmPerPx > 0);
  }
  assert.ok(mockSearch('sample').length >= 2);
  assert.ok(mockSearch('zzzz').length >= 2);
  assert.ok(mockSearch('quia')[0].label.includes('(sample)'));
});

function lotFromFixture(i = 0) {
  const f = FIXTURES[i];
  return buildSiteLot({ lot: f.lot, aerialMeta: f.aerial, aerialKey: 'k1', contours: f.contours, address: f.search[0].label, source: 'sample' });
}

test('buildSiteLot maps MGA to plan millimetres with north up', () => {
  const f = FIXTURES[0];
  const lot = lotFromFixture(0);
  // Every boundary vertex equals the response vertex with northing negated.
  f.lot.lot.polygons[0].outer.forEach(([dx, dn], i) => {
    near(lot.boundary[i].x, dx * 1000, 0.1);
    near(lot.boundary[i].y, -dn * 1000, 0.1);
  });
  assert.equal(lot.northRef, 'MGA grid north');
  assert.equal(lot.setbacks, null);
  assert.equal(lot.envelope, null);
  assert.equal(lot.lotLabel, 'Lot 27 DP 1234567');
  assert.equal(lot.neighbours.length, f.lot.neighbours.length);
  assert.ok(lot.neighbours.every((n) => n.lotNumber && n.planLabel && n.ring.length >= 4));
  // Edge lengths: the sample lot is 40 m by 50 m (2,000 m2, R5), to two decimals.
  const labels = boundaryEdges(lot).map((e) => e.label).sort();
  assert.deepEqual(labels, ['40.00', '40.00', '50.00', '50.00']);
  near(lot.areaM2, 2000, 0.5);
  assert.equal(lot.zoning.code, 'R5');
  // Contours: flat arrays, northing negated.
  const c = f.contours.contours[0];
  assert.equal(lot.contours[0].pts.length, c.points.length * 2);
  near(lot.contours[0].pts[1], -c.points[0][1] * 1000, 1);
});

test('terrain grid sits in plan mm and the default floor level is centroid RL plus 0.15 m', () => {
  const f = FIXTURES[0];
  const lot = lotFromFixture(0);
  const t = lot.terrain;
  assert.equal(t.cellMm, 2000);
  assert.equal(t.values.length, t.cols * t.rows);
  near(t.x0, f.contours.grid.x0 * 1000, 1);
  near(t.y0, -f.contours.grid.y0 * 1000, 1); // the north edge is the top row
  // The sample ground rises to the north (0.032 per metre), so the top row (north) is higher than the bottom row.
  assert.ok(t.values[0] > t.values[t.values.length - 1] - 5);
  const c = terrainAt(t, 0, 0);
  assert.ok(Math.abs(c - (398.4 + 0.35 * 0)) < 1.5, `centroid RL ${c}`);
  near(floorRLOf(lot), Math.round((c + 0.15) * 100) / 100, 0.006);
  assert.equal(terrainAt(t, 1e7, 0), null);
  const noTerrain = buildSiteLot({ lot: f.lot, contours: null });
  assert.equal(noTerrain.terrain, null);
  assert.equal(noTerrain.floorRL, null);
  assert.equal(floorRLOf(noTerrain), 0);
});

test('aerial is placed to scale and locked', () => {
  const f = FIXTURES[1];
  const lot = lotFromFixture(1);
  const u = underlayFor(lot);
  assert.equal(u.locked, true);
  assert.equal(u.rotation, 0);
  const ext = aerialExtentPlan(f.aerial.bbox, f.lot.origin);
  near(u.x, (ext.x0 + ext.x1) / 2, 1);
  near(u.y, (ext.y0 + ext.y1) / 2, 1);
  // Width of the image in plan mm: pixels x mm per pixel equals the bbox width.
  near(f.aerial.widthPx * u.mmPerPx, (f.aerial.bbox.maxE - f.aerial.bbox.minE) * 1000, f.aerial.mmPerPx * 2);
  assert.ok(ext.y0 < ext.y1); // north is the top edge
  assert.equal(underlayFor(buildSiteLot({ lot: f.lot })), null);
});

test('layers are on by default and can be switched off', () => {
  const lot = lotFromFixture(0);
  for (const id of ['boundary', 'neighbours', 'aerial', 'contours', 'labels', 'dimensions']) assert.ok(layerOn(lot, id), id);
  lot.layers.contours = false;
  assert.equal(layerOn(lot, 'contours'), false);
  assert.equal(layerOn(null, 'contours'), false);
});

// Schema ---------------------------------------------------------------------------------------------------------------------
test('schema 2 adds site.lot; schema 1 projects still load', () => {
  assert.equal(SCHEMA_VERSION, 2);
  const p = createProject();
  assert.equal(p.site.lot, null);
  assert.equal(p.schema, 2);
  const old = structuredClone(p);
  old.schema = 1;
  delete old.site.lot;
  const m = migrate(old);
  assert.equal(m.schema, 2);
  assert.equal(m.site.lot, null);
  assert.deepEqual(validate(m), []);
  // A schema 1 project with a stray bad lot value gets null
  old.site.lot = 'nope';
  assert.equal(migrate(old).site.lot, null);
  // A lot survives migration untouched
  const withLot = createProject();
  withLot.site.lot = lotFromFixture(0);
  assert.deepEqual(migrate(withLot).site.lot.boundary, withLot.site.lot.boundary);
  assert.throws(() => migrate({ ...p, schema: 3 }), /newer version/);
});

test('recentreDesign moves the footprint to the lot centroid in snap steps', () => {
  const p = createProject();
  const l = p.levels[0];
  l.walls.push({ id: 'w1', a: { x: 0, y: 0 }, b: { x: 10000, y: 0 }, thickness: 250 }, { id: 'w2', a: { x: 10000, y: 0 }, b: { x: 10000, y: 8000 }, thickness: 250 });
  l.furniture.push({ id: 'f1', item: 'sofa_3', x: 2000, y: 2000, rotation: 0 });
  p.site.tanks.push({ id: 't1', x: 12000, y: 500, diameter: 1850, height: 2000 });
  assert.ok(recentreDesign(p));
  assert.deepEqual(l.walls[0].a, { x: -5000, y: -4000 });
  assert.deepEqual(l.furniture[0], { id: 'f1', item: 'sofa_3', x: -3000, y: -2000, rotation: 0 });
  assert.equal(p.site.tanks[0].x, 7000);
  assert.equal(recentreDesign(createProject({})), false); // nothing drawn, nothing to move
});

// 3D terrain ---------------------------------------------------------------------------------------------------------------------
function designOnLot() {
  const p = createProject();
  const l = p.levels[0];
  l.walls.push({ id: 'w1', a: { x: -4000, y: -3000 }, b: { x: 4000, y: -3000 }, thickness: 250, kind: 'exterior', outside: 0, auto: true, status: 'new', finish: null, height: null });
  l.walls.push({ id: 'w2', a: { x: 4000, y: -3000 }, b: { x: 4000, y: 3000 }, thickness: 250, kind: 'exterior', outside: 0, auto: true, status: 'new', finish: null, height: null });
  l.walls.push({ id: 'w3', a: { x: 4000, y: 3000 }, b: { x: -4000, y: 3000 }, thickness: 250, kind: 'exterior', outside: 0, auto: true, status: 'new', finish: null, height: null });
  l.walls.push({ id: 'w4', a: { x: -4000, y: 3000 }, b: { x: -4000, y: -3000 }, thickness: 250, kind: 'exterior', outside: 0, auto: true, status: 'new', finish: null, height: null });
  p.site.lot = lotFromFixture(0);
  return p;
}

test('terrain model: pad under the house, natural ground away from it, floor RL shifts heights', () => {
  const p = designOnLot();
  const tm = terrainModel(p);
  const lot = p.site.lot;
  assert.equal(tm.base, 0);
  near(tm.heightAt(0, 0), -0.15, 1e-9); // flat pad at slab level under the house
  const far = tm.heightAt(-9000, 18000);
  const raw = terrainAt(lot.terrain, -9000, 18000) - lot.floorRL;
  near(far, raw, 1e-6);
  const before = tm.heightAt(-9000, 18000);
  lot.floorRL += 1;
  near(terrainModel(p).heightAt(-9000, 18000), before - 1, 1e-6);
  assert.equal(terrainModel(createProject()), null);
});

test('buildModel drapes the site terrain and keeps the flat ground without a lot', () => {
  const p = designOnLot();
  const tex = new THREE.Texture();
  const g = buildModel(p, { siteTexture: tex });
  const terrain = g.getObjectByName('site-terrain');
  assert.ok(terrain);
  assert.equal(terrain.userData.ground, true);
  assert.equal(terrain.material.map, tex);
  assert.ok(g.getObjectByName('lot-boundary'));
  const uv = terrain.geometry.attributes.uv;
  for (let i = 0; i < uv.array.length; i++) assert.ok(uv.array[i] >= 0 && uv.array[i] <= 1);
  const pos = terrain.geometry.attributes.position;
  for (let i = 0; i < pos.array.length; i++) assert.ok(Number.isFinite(pos.array[i]));
  // No texture: a plain surface, still terrain
  assert.equal(buildModel(p).getObjectByName('site-terrain').material.map ?? null, null);
  // No lot: the old flat ground only
  const flat = buildModel(createProject());
  assert.equal(flat.getObjectByName('site-terrain'), undefined);
  assert.equal(flat.getObjectByName('ground').userData.ground, true);
  // A project with a lot but no elevation grid still shows the site: flat ground at slab level, boundary and all
  const noGrid = designOnLot();
  noGrid.site.lot.terrain = null;
  const ng = buildModel(noGrid);
  assert.ok(ng.getObjectByName('site-terrain'));
  assert.ok(ng.getObjectByName('lot-boundary'));
});

test('templates still build with schema 2', () => {
  for (const t of TEMPLATES.slice(0, 3)) assert.ok(buildModel(migrate(t.create())));
});

// Frontage ------------------------------------------------------------------------------------------------------------------------
import { deriveFrontage, toggleEdge, nearestEdge, isCorner } from '../src/site/frontage.js';
import { siteCredits, creditsOneLine, contourNote, INDICATIVE } from '../src/site/credits.js';

const sq = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];

test('frontage: the sample street lot gets its one street edge, not a corner lot', () => {
  for (const i of [0, 1]) {
    const lot = lotFromFixture(i);
    assert.equal(lot.frontEdges.length, 1, `fixture ${i}`);
    assert.equal(lot.cornerLot, false);
    assert.equal(lot.frontageConfirmed, false);
    assert.equal(lot.frontageMethod, 'no-lot-beyond');
  }
});

test('frontage: a corner lot has two adjacent street edges; a through lot is not a corner', () => {
  // Lot 0..20 x 0..30 (plan mm, y down). Neighbours on the east (x 20..40) and south (y 30..60): the west and north edges face the street.
  const lot = { boundary: sq(0, 0, 20000, 30000), neighbours: [{ ring: sq(20000, 0, 40000, 30000) }, { ring: sq(0, 30000, 20000, 60000) }] };
  const f = deriveFrontage(lot);
  assert.deepEqual(f.frontEdges, [0, 3]); // north edge (0) and west edge (3)
  assert.equal(f.cornerLot, true);
  assert.equal(isCorner(lot, [0, 3]), true);
  // Through lot: neighbours east and west only, so north and south are both street edges, opposite each other
  const through = { boundary: sq(0, 0, 20000, 30000), neighbours: [{ ring: sq(20000, 0, 40000, 30000) }, { ring: sq(-20000, 0, 0, 30000) }] };
  const t = deriveFrontage(through);
  assert.deepEqual(t.frontEdges, [0, 2]);
  assert.equal(t.cornerLot, false);
  // Fully enclosed (all neighbours): falls back to the longest edge
  const boxed = { boundary: sq(0, 0, 20000, 30000), neighbours: [sq(20000, 0, 40000, 30000), sq(-20000, 0, 0, 30000), sq(0, 30000, 20000, 60000), sq(0, -30000, 20000, 0)].map((ring) => ({ ring })) };
  const b = deriveFrontage(boxed);
  assert.equal(b.method, 'longest-edge');
  assert.equal(b.frontEdges.length, 1);
});

test('frontage: a road parcel next door counts as street, road centrelines pick the real frontage', () => {
  const lot = { boundary: sq(0, 0, 20000, 30000), neighbours: [{ ring: sq(0, -10000, 20000, 0), isRoad: true }, { ring: sq(20000, 0, 40000, 30000) }] };
  assert.deepEqual(deriveFrontage(lot).frontEdges.includes(0), true);
  // Three open sides (west, north, south) but the road runs along the north only
  const open = { boundary: sq(0, 0, 20000, 30000), neighbours: [{ ring: sq(20000, 0, 40000, 30000) }], roads: [{ name: 'MAIN ST', pts: [-5000, -8000, 25000, -8000] }] };
  const f = deriveFrontage(open);
  assert.deepEqual(f.frontEdges, [0]);
  assert.equal(f.method, 'roads');
});

test('frontage: clicking toggles edges; nearest edge uses a tolerance', () => {
  assert.deepEqual(toggleEdge([2], 3), [2, 3]);
  assert.deepEqual(toggleEdge([2, 3], 2), [3]);
  const b = sq(0, 0, 20000, 30000);
  assert.equal(nearestEdge(b, { x: 10000, y: -200 }, 500), 0);
  assert.equal(nearestEdge(b, { x: 20100, y: 15000 }, 500), 1);
  assert.equal(nearestEdge(b, { x: 10000, y: 15000 }, 500), -1);
});

// Credits and accuracy ----------------------------------------------------------------------------------------------------------
test('credits name the licence and the contour accuracy on every lot', () => {
  const nsw = siteCredits(lotFromFixture(0));
  const qld = siteCredits(lotFromFixture(1));
  const nswText = nsw.map((c) => c.text).join(' ');
  const qldText = qld.map((c) => c.text).join(' ');
  assert.match(nswText, /CC BY 3\.0 AU/);
  assert.match(nswText, /NSW 5 m DEM, indicative only; detailed survey required/);
  assert.match(qldText, /CC BY 4\.0/);
  assert.match(qldText, /no warranty/);
  assert.match(qldText, /Queensland DEM, indicative only; detailed survey required/);
  assert.ok(nsw.some((c) => c.id === 'zoning'));
  assert.ok(!qld.some((c) => c.id === 'zoning'));
  assert.match(contourNote(null), /indicative only/);
  assert.match(INDICATIVE, /registered survey/);
  assert.ok(creditsOneLine(lotFromFixture(0)).length > 100);
  assert.deepEqual(siteCredits(null), []);
});

test('the PDF footer carries the site credits when a lot is present', async () => {
  const { jsPDF } = await import('jspdf');
  const { toPDF } = await import('../src/premium/exporters/pdf.js');
  const p = designOnLot();
  const withLot = toPDF(p, { jsPDF });
  const without = toPDF(createProject(), { jsPDF });
  assert.ok(withLot.length > 1000 && without.length > 1000);
  // jsPDF writes text uncompressed in the content streams only when compression is off, so check through a spy doc instead
  const seen = [];
  const Spy = function (...args) {
    const d = new jsPDF(...args);
    const orig = d.text.bind(d);
    d.text = (t, ...rest) => {
      seen.push(Array.isArray(t) ? t.join(' ') : String(t));
      return orig(t, ...rest);
    };
    return d;
  };
  toPDF(p, { jsPDF: Spy });
  const all = seen.join('\n');
  assert.match(all, /Site data:/);
  assert.match(all, /CC BY 3\.0 AU/);
  assert.match(all, /indicative only/);
  seen.length = 0;
  toPDF(createProject(), { jsPDF: Spy });
  assert.doesNotMatch(seen.join('\n'), /Site data:/);
});
