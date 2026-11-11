// 3D site (terrain extent, pad, draping, labels), the Split view mode and the Back target.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createProject } from '../src/model/schema.js';
import { FIXTURES } from '../src/site/fixtures/index.js';
import { buildSiteLot } from '../src/site/model.js';
import { buildModel } from '../src/viewer3d/build.js';
import { addSiteTerrain, terrainModel } from '../src/viewer3d/terrain.js';
import * as S from '../src/viewer3d/site-geom.js';
import * as V from '../src/ui/view-mode.js';
import { backTarget } from '../src/ui/back-target.js';

const near = (a, b, tol = 1e-6, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} vs ${b}`);

function lot() {
  const f = FIXTURES[0];
  return buildSiteLot({ lot: f.lot, aerialMeta: f.aerial, aerialKey: 'k1', contours: f.contours, address: f.search[0].label, source: 'sample' });
}
function designOnLot(rot = 0) {
  const p = createProject();
  const c = Math.cos((rot * Math.PI) / 180);
  const s = Math.sin((rot * Math.PI) / 180);
  const R = (x, y) => ({ x: Math.round(x * c - y * s), y: Math.round(x * s + y * c) });
  const pts = [[-4000, -3000], [4000, -3000], [4000, 3000], [-4000, 3000]];
  pts.forEach((a, i) => {
    const b = pts[(i + 1) % 4];
    p.levels[0].walls.push({ id: `w${i}`, a: R(...a), b: R(...b), thickness: 250, kind: 'exterior', outside: 0, auto: true, status: 'new', finish: null, height: null });
  });
  p.site.lot = lot();
  return p;
}
const ctx = { lib: { get: () => new THREE.MeshStandardMaterial() } };

// View modes ------------------------------------------------------------------------------------------------------------------------
test('view modes: Split sits between Plan and 3D and has both panes', () => {
  assert.deepEqual(V.VIEW_IDS, ['2d', 'split', '3d', 'walk']);
  assert.equal(V.VIEWS[1][1], 'Split');
  assert.ok(V.hasPlan('2d') && V.hasPlan('split') && !V.hasPlan('3d') && !V.hasPlan('walk'));
  assert.ok(V.has3d('split') && V.has3d('3d') && V.has3d('walk') && !V.has3d('2d'));
  assert.equal(V.normalizeView('bogus'), '2d');
  assert.equal(V.normalizeView('split'), 'split');
  assert.ok(V.canReturnToPlan('split') && V.canReturnToPlan('3d') && V.canReturnToPlan('walk') && !V.canReturnToPlan('2d'));
});

test('last view is remembered per user, survives blocked storage, and walk comes back as 3D', () => {
  const mem = new Map();
  const st = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, v) };
  assert.equal(V.readLastView(st), null);
  assert.ok(V.writeLastView(st, 'split'));
  assert.equal(V.readLastView(st), 'split');
  V.writeLastView(st, '3d', 'user_7');
  assert.equal(V.readLastView(st, 'user_7'), '3d');
  assert.equal(V.readLastView(st), 'split'); // another user's choice does not leak
  V.writeLastView(st, 'walk');
  assert.equal(V.readLastView(st), '3d');
  mem.set(V.lastViewKey(), 'nonsense');
  assert.equal(V.readLastView(st), null);
  const blocked = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.equal(V.readLastView(blocked), null);
  assert.equal(V.writeLastView(blocked, 'split'), false);
  assert.equal(V.readSplit(blocked), V.SPLIT_DEFAULT);
  assert.notEqual(V.lastViewKey('a b/c'), V.lastViewKey('a_b_c_'));
});

test('start view: ?view= wins, phones open 3D, the demo opens the plan, else the remembered view', () => {
  assert.equal(V.startView({ param: 'split', remembered: '3d' }), 'split');
  assert.equal(V.startView({ param: 'x', phone: true, remembered: 'split' }), '3d');
  assert.equal(V.startView({ remembered: 'split' }), 'split');
  assert.equal(V.startView({ remembered: 'split', demo: true }), '2d');
  assert.equal(V.startView({}), 'split');
});

test('split divider maths: clamps and follows the pointer both ways', () => {
  assert.equal(V.clampSplit(0.1), V.SPLIT_MIN);
  assert.equal(V.clampSplit(0.95), V.SPLIT_MAX);
  assert.equal(V.clampSplit(NaN), V.SPLIT_DEFAULT);
  const rect = { left: 100, top: 50, width: 1000, height: 600 };
  near(V.splitFromPointer(rect, 600, 0, false), 0.5);
  near(V.splitFromPointer(rect, 100, 0, false), V.SPLIT_MIN);
  near(V.splitFromPointer(rect, 0, 200, true), 0.25);
  near(V.splitFromPointer(rect, 0, 350, true), 0.5);
});

test('Escape leaves 3D and split for the plan only when nothing else needs the key', () => {
  assert.equal(V.escapeLeavesView({ view: '3d' }), true);
  assert.equal(V.escapeLeavesView({ view: 'split' }), true);
  assert.equal(V.escapeLeavesView({ view: '2d' }), false);
  assert.equal(V.escapeLeavesView({ view: 'walk' }), false); // the walk controller returns to 3D first
  assert.equal(V.escapeLeavesView({ view: '3d', selection: 'f1' }), false);
  assert.equal(V.escapeLeavesView({ view: 'split', tool: 'wall' }), false);
  assert.equal(V.escapeLeavesView({ view: '3d', editing: true }), false);
  assert.equal(V.escapeLeavesView({ view: '3d', modalOpen: true }), false);
  assert.equal(V.escapeLeavesView({ view: '3d', typing: true }), false);
  assert.equal(V.escapeLeavesView({ view: '3d', defaultPrevented: true }), false);
});

// Back target -----------------------------------------------------------------------------------------------------------------------
test('back target: ?back=, same site referrer, portal for signed in users, home last', () => {
  const here = 'https://glideinside.com.au/tools/pocket-architect/index.html?x=1';
  const base = { here, portalUrl: 'https://glideinside.com.au/portal/', homeUrl: '../../index.html' };
  assert.deepEqual(backTarget({ ...base, back: '/blog/how-it-works/' }), { url: 'https://glideinside.com.au/blog/how-it-works/', kind: 'param' });
  assert.deepEqual(backTarget({ ...base, referrer: 'https://glideinside.com.au/pricing/' }), { url: 'https://glideinside.com.au/pricing/', kind: 'referrer' });
  // a referrer from another site, or the app itself (a reload), is not a way back
  assert.equal(backTarget({ ...base, referrer: 'https://www.google.com/search?q=x', role: 'builder' }).kind, 'portal');
  assert.equal(backTarget({ ...base, referrer: 'https://glideinside.com.au/tools/pocket-architect/' }).kind, 'home');
  assert.equal(backTarget({ ...base, role: 'client' }).kind, 'portal');
  assert.equal(backTarget({ ...base, role: 'client', referrer: 'https://glideinside.com.au/portal/houses/' }).kind, 'referrer');
  assert.deepEqual(backTarget(base), { url: 'https://glideinside.com.au/index.html', kind: 'home' });
  // unsafe or foreign ?back= values are ignored
  assert.equal(backTarget({ ...base, back: 'https://evil.example/' }).kind, 'home');
  assert.equal(backTarget({ ...base, back: 'javascript:alert(1)' }).kind, 'home');
  assert.equal(backTarget({ ...base, back: '//evil.example/x' }).kind, 'home');
});

// Terrain extent, grid and clip ---------------------------------------------------------------------------------------------------------
test('terrain extent is the aerial extent exactly, and always contains the lot', () => {
  const l = lot();
  const ext = S.terrainExtent(l);
  assert.deepEqual(ext, l.aerial.extent);
  const noAerial = { ...l, aerial: null, terrain: null };
  const e2 = S.terrainExtent(noAerial, 30);
  const bx = noAerial.boundary.map((p) => p.x);
  assert.ok(e2.x0 <= Math.min(...bx) - 30000 + 1 && e2.x1 >= Math.max(...bx) + 30000 - 1);
  for (const p of l.boundary) assert.ok(p.x >= ext.x0 && p.x <= ext.x1 && p.y >= ext.y0 && p.y <= ext.y1);
  // an aerial that does not cover the lot is grown to cover it
  const small = S.terrainExtent({ ...l, aerial: { extent: { x0: -1000, y0: -1000, x1: 1000, y1: 1000 } } });
  for (const p of l.boundary) assert.ok(p.x >= small.x0 && p.x <= small.x1 && p.y >= small.y0 && p.y <= small.y1);
  assert.equal(S.terrainExtent(null), null);
});

test('terrain grid lands exactly on the extent edges (no ragged or diagonal clip) and stays within the cell cap', () => {
  for (const ext of [{ x0: -44000, y0: -52000, x1: 44000, y1: 52000 }, { x0: 0, y0: 0, x1: 700000, y1: 3000 }, { x0: 5, y0: 5, x1: 90, y1: 70 }]) {
    const g = S.gridDims(ext);
    near(g.x0 + (g.cols - 1) * g.dx, ext.x1, 1e-6);
    near(g.y0 + (g.rows - 1) * g.dy, ext.y1, 1e-6);
    assert.ok(g.cols - 1 <= S.MAX_GRID_CELLS + 1 && g.rows - 1 <= S.MAX_GRID_CELLS + 1);
    assert.ok(g.dx > 0 && g.dy > 0);
  }
});

test('the elevation grid is clamped outside its edge so the mesh has no holes', () => {
  const p = designOnLot();
  const t = p.site.lot.terrain;
  const edgeVal = S.terrainAtClamped(t, t.x0, t.y0);
  assert.equal(S.terrainAtClamped(t, t.x0 - 99999, t.y0 - 99999), edgeVal);
  assert.ok(Number.isFinite(S.terrainAtClamped(t, t.x0 + 1e9, t.y0 + 1e9)));
  assert.equal(S.terrainAtClamped(null, 0, 0), null);
});

test('site terrain mesh covers the aerial extent as a clean rectangle with finite heights and uvs 0 to 1', () => {
  const p = designOnLot();
  const root = new THREE.Group();
  const r = addSiteTerrain(ctx, root, p, { texture: new THREE.Texture() });
  const ext = p.site.lot.aerial.extent;
  const mesh = root.getObjectByName('site-terrain');
  const pos = mesh.geometry.attributes.position;
  const uv = mesh.geometry.attributes.uv;
  let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    assert.ok(Number.isFinite(pos.getX(i) + pos.getY(i) + pos.getZ(i)));
    minX = Math.min(minX, pos.getX(i)); maxX = Math.max(maxX, pos.getX(i));
    minZ = Math.min(minZ, pos.getZ(i)); maxZ = Math.max(maxZ, pos.getZ(i));
  }
  near(minX, ext.x0 / 1000, 1e-3); near(maxX, ext.x1 / 1000, 1e-3); // float32 positions
  near(minZ, ext.y0 / 1000, 1e-3); near(maxZ, ext.y1 / 1000, 1e-3);
  for (let i = 0; i < uv.array.length; i++) assert.ok(uv.array[i] >= 0 && uv.array[i] <= 1);
  // every triangle faces up (counter clockwise seen from +Y)
  const idx = mesh.geometry.index.array;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i]; const b = idx[i + 1]; const c = idx[i + 2];
    const cross = (pos.getX(b) - pos.getX(a)) * (pos.getZ(c) - pos.getZ(a)) - (pos.getZ(b) - pos.getZ(a)) * (pos.getX(c) - pos.getX(a));
    assert.ok(cross < 0, 'triangle winding');
  }
  assert.ok(r.outerR > 500);
  // the horizon ring joins the terrain edge: its first loop is the terrain perimeter
  const ring = root.getObjectByName('site-horizon');
  assert.ok(ring);
  const rp = ring.geometry.attributes.position;
  for (let i = 0; i < rp.count; i++) assert.ok(Number.isFinite(rp.getX(i) + rp.getY(i) + rp.getZ(i)));
});

// Pad and batter --------------------------------------------------------------------------------------------------------------------------
test('building pad: level at slab height under the house, 1:3 batter, then natural ground', () => {
  const padY = -0.15;
  assert.equal(S.padHeight(2, padY, 0), padY);
  assert.equal(S.padHeight(2, padY, S.PAD_MARGIN_M), padY);
  // fill up to 1 m above the pad: batter run is 3 m, slope 1:3
  near(S.padHeight(0.85, padY, S.PAD_MARGIN_M + 1.5), padY + 0.5, 1e-9);
  assert.equal(S.padHeight(0.85, padY, S.PAD_MARGIN_M + 3), 0.85);
  assert.equal(S.padHeight(0.85, padY, S.PAD_MARGIN_M + 50), 0.85);
  // cut: ground below the pad
  near(S.padHeight(-1.15, padY, S.PAD_MARGIN_M + 1.5), padY - 0.5, 1e-9);
  // flat ground: no batter at all
  assert.equal(S.padHeight(padY, padY, S.PAD_MARGIN_M + 0.01), padY);
  // continuous: no step at the pad edge
  near(S.padHeight(3, padY, S.PAD_MARGIN_M + 1e-9), padY, 1e-6);
});

test('terrain model: house footprint sits on the pad and the ground meets it without a gap', () => {
  const p = designOnLot();
  const tm = terrainModel(p);
  near(tm.heightAt(0, 0), -0.15, 1e-9);
  near(tm.heightAt(4000, 3000), -0.15, 1e-9); // footprint corner
  near(tm.heightAt(4000 + 900, 0), -0.15, 1e-9); // inside the 1 m level margin
  const far = tm.heightAt(-9000, 18000);
  assert.ok(Number.isFinite(far));
  // the batter is a continuous surface: neighbouring samples differ by no more than the slope allows
  let prev = tm.heightAt(5000, 0);
  for (let x = 5100; x <= 20000; x += 100) {
    const h = tm.heightAt(x, 0);
    assert.ok(Math.abs(h - prev) <= 0.1 * 1.01 + 0.35, `jump at ${x}: ${prev} to ${h}`);
    prev = h;
  }
  assert.equal(terrainModel(createProject()), null);
  // no elevation grid: flat at slab height everywhere
  const flat = designOnLot();
  flat.site.lot.terrain = null;
  near(terrainModel(flat).heightAt(-9000, 18000), -0.15, 1e-9);
});

// Draping -----------------------------------------------------------------------------------------------------------------------------------
test('surfaceAt follows the drawn triangles exactly', () => {
  const cols = 5; const rows = 4;
  const heights = new Float32Array(cols * rows).map((_, i) => Math.sin(i * 1.7) * 2);
  const grid = { cols, rows, x0: 1000, y0: -2000, dx: 1500, dy: 900, heights };
  const idx = S.gridIndices(cols, rows);
  const P = (k) => ({ x: grid.x0 + (k % cols) * grid.dx, y: grid.y0 + Math.floor(k / cols) * grid.dy, h: heights[k] });
  for (let t = 0; t < idx.length; t += 3) {
    const [A, B, C] = [P(idx[t]), P(idx[t + 1]), P(idx[t + 2])];
    // barycentric centre of each triangle, plus a point a third of the way to a corner
    for (const w of [[1 / 3, 1 / 3, 1 / 3], [0.6, 0.3, 0.1], [0.1, 0.1, 0.8]]) {
      const x = A.x * w[0] + B.x * w[1] + C.x * w[2];
      const y = A.y * w[0] + B.y * w[1] + C.y * w[2];
      near(S.surfaceAt(grid, x, y), A.h * w[0] + B.h * w[1] + C.h * w[2], 1e-5, `tri ${t / 3}`);
    }
  }
  // clamped outside
  near(S.surfaceAt(grid, -1e9, -1e9), heights[0], 1e-9);
});

test('boundary is draped on the terrain surface with a small lift (never under, never floating)', () => {
  const p = designOnLot();
  const root = new THREE.Group();
  addSiteTerrain(ctx, root, p, { texture: null });
  const b = root.getObjectByName('lot-boundary');
  assert.ok(b && b.userData.lotBoundary && b.userData.frame);
  const terrain = root.getObjectByName('site-terrain');
  const tp = terrain.geometry.attributes.position;
  const ext = p.site.lot.aerial.extent;
  const dims = S.gridDims(ext);
  const heights = new Float32Array(dims.cols * dims.rows);
  for (let k = 0; k < heights.length; k++) heights[k] = tp.getY(k);
  const grid = { ...dims, heights };
  const bp = b.geometry.attributes.position;
  for (let i = 0; i < bp.count; i++) {
    const x = bp.getX(i) * 1000; const z = bp.getZ(i) * 1000;
    const ground = S.surfaceAt(grid, x, z);
    const lift = bp.getY(i) - ground;
    assert.ok(lift > 0.02 && lift < 0.2, `lift ${lift} at vertex ${i}`);
  }
  // every drape point is the surface plus exactly the lift
  const ring = S.drapePolyline(p.site.lot.boundary, (x, y) => S.surfaceAt(grid, x, y), { step: 0.5, lift: 0.07, closed: true });
  for (const q of ring) near(q[1], S.surfaceAt(grid, q[0] * 1000, q[2] * 1000) + 0.07, 1e-6);
  // resampled at 0.5 m or finer
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]; const c = ring[(i + 1) % ring.length];
    assert.ok(Math.hypot(c[0] - a[0], c[2] - a[2]) <= 0.51);
  }
});

test('ribbon, dash and ring helpers return valid geometry', () => {
  const pts = [[0, 0, 0], [10, 0, 0], [10, 1, 10]];
  const r = S.ribbonGeometry(pts, 0.2, false);
  assert.equal(r.positions.length, pts.length * 6);
  assert.equal(r.indices.length, (pts.length - 1) * 6);
  for (const i of r.indices) assert.ok(i < pts.length * 2);
  const closed = S.ribbonGeometry(pts, 0.2, true);
  assert.equal(closed.indices.length, pts.length * 6);
  const dashes = S.dashPolyline([[0, 0, 0], [20, 0, 0]], 2, 1);
  assert.equal(dashes.length, 7);
  for (const d of dashes) near(Math.abs(d[d.length - 1][0] - d[0][0]), 2, 1e-6);
  assert.equal(dashes.length * 2, 14);
  assert.deepEqual(S.dashPolyline([[0, 0, 0]], 2, 1), []);
  const nodes = S.perimeterNodes(4, 3);
  assert.equal(nodes.length, 2 * (4 - 1) + 2 * (3 - 1));
  assert.equal(new Set(nodes.map((n) => `${n.i},${n.j}`)).size, nodes.length);
  const fr = S.fadeRing(nodes.map((n) => ({ x: n.i, y: 0, z: n.j, dir: n.dir })), -0.1);
  assert.equal(fr.positions.length / 3, nodes.length * S.RING_OFFSETS_M.length);
  assert.equal(fr.indices.length, nodes.length * 6 * (S.RING_OFFSETS_M.length - 1));
  assert.equal(Math.max(...fr.colourT), 1);
  assert.equal(Math.min(...fr.colourT), 0);
});

// The site is always built when a lot is loaded ---------------------------------------------------------------------------------------------------
test('every 3D build of a design on a lot shows terrain, boundary, neighbours, labels and frontage, with or without the aerial', () => {
  for (const variant of ['aerial', 'no-aerial', 'no-grid']) {
    const p = designOnLot();
    if (variant === 'no-aerial') p.site.lot.aerial = null;
    if (variant === 'no-grid') p.site.lot.terrain = null;
    p.site.lot.frontEdges = [1];
    p.site.lot.envelope = p.site.lot.boundary.map((q) => ({ x: q.x * 0.8, y: q.y * 0.8 }));
    for (const opts of [{}, { levelFilter: p.levels[0].id }, { showRoof: false }, { siteTexture: new THREE.Texture() }, { walk: true }, { showContours: true }]) {
      const g = buildModel(p, opts);
      for (const name of ['site-terrain', 'site-horizon', 'lot-boundary', 'neighbour-boundaries', 'setback-envelope', 'street-frontage']) assert.ok(g.getObjectByName(name), `${variant} ${JSON.stringify(Object.keys(opts))} missing ${name}`);
      assert.equal(g.getObjectByName('ground'), undefined); // the flat disc is only for designs without a lot
    }
    assert.ok(buildModel(p, { showContours: true }).getObjectByName('site-contours-minor') || p.site.lot.contours.length === 0);
    assert.equal(buildModel(p, {}).getObjectByName('site-contours-minor'), undefined);
  }
  // no lot: the flat ground
  assert.ok(buildModel(createProject()).getObjectByName('ground'));
  // layers switched off in the panel are respected
  const p = designOnLot();
  p.site.lot.layers = { ...p.site.lot.layers, boundary: false, neighbours: false, setbacks: false };
  const g = buildModel(p);
  assert.equal(g.getObjectByName('lot-boundary'), undefined);
  assert.equal(g.getObjectByName('neighbour-boundaries'), undefined);
  assert.ok(g.getObjectByName('site-terrain'));
});

test('lot and neighbour labels carry the lot number and DP on separate lines; roads get none', () => {
  const l = lot();
  const labels = S.siteLabels(l);
  const me = labels.find((x) => x.kind === 'lot');
  assert.equal(me.lines[0], `Lot ${l.lotNumber}`);
  assert.equal(me.lines[1], l.planLabel);
  assert.ok(me.lines[2].endsWith('m²'));
  const others = labels.filter((x) => x.kind === 'neighbour');
  assert.ok(others.length > 3);
  for (const o of others) assert.ok(o.lines.length === 2 && /^Lot /.test(o.lines[0]));
  const withRoad = { ...l, neighbours: [...l.neighbours, { id: 'r', isRoad: true, ring: l.neighbours[0].ring, lotNumber: '9' }] };
  assert.equal(S.siteLabels(withRoad).length, labels.length);
  assert.deepEqual(S.siteLabels(null), []);
  assert.deepEqual(S.frontagePolylines({ boundary: l.boundary, frontEdges: [0, 99, -1] }).length, 1);
});

// 3D follows the plan ---------------------------------------------------------------------------------------------------------------------------
test('3D uses plan coordinates one to one, so the house follows the 2D placement rotation exactly', () => {
  for (const rot of [0, 30, 137, -90]) {
    const p = designOnLot(rot);
    const walls = p.levels[0].walls;
    const xs = walls.flatMap((w) => [w.a.x, w.b.x]);
    const ys = walls.flatMap((w) => [w.a.y, w.b.y]);
    const g = buildModel(p);
    const box = new THREE.Box3();
    g.traverse((o) => {
      if (o.isMesh && o.userData.kind === 'wall') box.union(new THREE.Box3().setFromObject(o));
    });
    // wall thickness (250 mm) adds at most the diagonal of its half width either side
    const pad = 0.2;
    assert.ok(box.min.x * 1000 >= Math.min(...xs) - pad * 1000 && box.max.x * 1000 <= Math.max(...xs) + pad * 1000, `x extent at ${rot} degrees`);
    assert.ok(box.min.z * 1000 >= Math.min(...ys) - pad * 1000 && box.max.z * 1000 <= Math.max(...ys) + pad * 1000, `z extent at ${rot} degrees`);
    assert.ok(box.max.x * 1000 >= Math.max(...xs) - pad * 1000 && box.min.x * 1000 <= Math.min(...xs) + pad * 1000);
  }
});

// Wide outer aerial ------------------------------------------------------------------------------------------------------------------
import { wideBbox, wideAerialParams, WIDE_MIN_M } from '../src/site/client.js';

function designOnWideLot() {
  const f = FIXTURES[0];
  const b = f.aerial.bbox;
  const wm = { ...f.aerial, bbox: wideBbox(b), mmPerPx: 340 };
  const p = designOnLot();
  p.site.lot = buildSiteLot({ lot: f.lot, aerialMeta: f.aerial, aerialKey: 'k1', aerialWideMeta: wm, aerialWideKey: 'k1.wide', contours: f.contours, address: f.search[0].label, source: 'sample' });
  return p;
}

test('wide aerial box reaches at least 300 m beyond the lot on every side and grows for big lots', () => {
  const small = { minE: 1000, minN: 2000, maxE: 1060, maxN: 2080 };
  const w = wideBbox(small);
  assert.ok(small.minE - w.minE >= WIDE_MIN_M && w.maxE - small.maxE >= WIDE_MIN_M);
  assert.ok(small.minN - w.minN >= WIDE_MIN_M && w.maxN - small.maxN >= WIDE_MIN_M);
  assert.equal(w.minE % 50, 0);
  const big = { minE: 0, minN: 0, maxE: 800, maxN: 500 };
  const wb = wideBbox(big);
  assert.ok(big.minE - wb.minE >= 600 && wb.maxN - big.maxN >= 600);
  const prm = wideAerialParams(small);
  assert.equal(prm.maxpx, '2048');
  assert.ok(Number(prm.res) <= 2 && Number(prm.res) >= 0.1);
  const [a, , c] = prm.bbox.split(',').map(Number);
  assert.ok((c - a) / Number(prm.res) <= 2048 + 1);
});

test('buildSiteLot keeps the wide tile only with the inner one, and it surrounds the inner extent', () => {
  const p = designOnWideLot();
  const l = p.site.lot;
  assert.equal(l.aerialWide.key, 'k1.wide');
  assert.ok(l.aerialWide.extent.x0 <= l.aerial.extent.x0 - 299000 && l.aerialWide.extent.y1 >= l.aerial.extent.y1 + 299000);
  const f = FIXTURES[0];
  assert.equal(buildSiteLot({ lot: f.lot, aerialMeta: null, aerialKey: null, aerialWideMeta: { bbox: f.aerial.bbox }, aerialWideKey: 'x', contours: f.contours }).aerialWide, null);
  assert.equal(lot().aerialWide, null);
});

test('terrain: the wide tile is a frame around the sharp inner mesh, inner extent unchanged, fade only beyond the wide edge', () => {
  const p = designOnWideLot();
  const root = new THREE.Group();
  const r = addSiteTerrain(ctx, root, p, { texture: new THREE.Texture(), wideTexture: new THREE.Texture(), wideEdgeColour: '#6f7a4a' });
  const inner = root.getObjectByName('site-terrain');
  const wide = root.getObjectByName('site-terrain-wide');
  assert.ok(inner && wide);
  assert.deepEqual(r.extent, p.site.lot.aerial.extent); // sharp inner tile keeps its resolution and extent
  assert.deepEqual(r.wideExtent, p.site.lot.aerialWide.extent);
  const pos = wide.geometry.attributes.position;
  const uv = wide.geometry.attributes.uv;
  const ex = p.site.lot.aerialWide.extent;
  let minX = Infinity; let maxX = -Infinity;
  for (let i = 0; i < pos.count; i++) { assert.ok(Number.isFinite(pos.getY(i))); minX = Math.min(minX, pos.getX(i)); maxX = Math.max(maxX, pos.getX(i)); }
  near(minX, ex.x0 / 1000, 1e-3); near(maxX, ex.x1 / 1000, 1e-3);
  for (let i = 0; i < uv.array.length; i++) assert.ok(uv.array[i] >= 0 && uv.array[i] <= 1);
  // no triangle sits wholly inside the inner extent (it would be hidden anyway)
  const idx = wide.geometry.index.array;
  const ie = r.extent;
  for (let i = 0; i < idx.length; i += 3) {
    const inside = [0, 1, 2].every((q) => { const x = pos.getX(idx[i + q]) * 1000; const z = pos.getZ(idx[i + q]) * 1000; return x >= ie.x0 - 1 && x <= ie.x1 + 1 && z >= ie.y0 - 1 && z <= ie.y1 + 1; });
    assert.ok(!inside);
    const [a, b, c] = [idx[i], idx[i + 1], idx[i + 2]];
    assert.ok((pos.getX(b) - pos.getX(a)) * (pos.getZ(c) - pos.getZ(a)) - (pos.getZ(b) - pos.getZ(a)) * (pos.getX(c) - pos.getX(a)) < 0, 'winding');
  }
  // the horizon fade starts at the wide edge: ring vertices at k=0 lie on the wide extent, and the ring colour starts as the wide edge colour
  const ring = root.getObjectByName('site-horizon');
  const rp = ring.geometry.attributes.position;
  const rc = ring.geometry.attributes.color;
  near(rp.getX(0), ex.x0 / 1000, 1e-3);
  near(rc.getX(0), new THREE.Color('#6f7a4a').r, 1e-3);
  assert.ok(r.outerR > (ex.x1 - ex.x0) / 2000);
});

test('terrain: without a wide texture (or an old project) the build is as before', () => {
  const p = designOnWideLot();
  const a = new THREE.Group();
  const ra = addSiteTerrain(ctx, a, p, { texture: new THREE.Texture() });
  assert.equal(a.getObjectByName('site-terrain-wide'), undefined);
  assert.equal(ra.wideExtent, null);
  const q = designOnLot();
  const b = new THREE.Group();
  addSiteTerrain(ctx, b, q, { texture: new THREE.Texture(), wideTexture: new THREE.Texture() });
  assert.equal(b.getObjectByName('site-terrain-wide'), undefined);
});
