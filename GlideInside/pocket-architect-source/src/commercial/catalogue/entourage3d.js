// Entourage for scale in the commercial 3D view: a few parked cars in the marked bays and a rigid truck backed up to a loading dock.
// Simple, tasteful shapes with no badges or brand names. One instanced mesh for all cars and one for all trucks (two draw calls), built
// from the same parking model the plan draws, so every car sits inside a marked bay. Deterministic: the same layout always parks the
// same cars. Bodies are lit so they sit in the scene; glass and tyres are dark vertex colours. Flagged `ground` so the camera framing
// and the sun's shadow box ignore them. Plan mm in, metres out; surf(xMm, yMm) -> Y metres.

import * as THREE from 'three';
import { parkingLayout } from '../parking.js';
import { buildingParking } from './bays.js';
import { buildingsOf } from './buildings.js';
import { runBuilding } from './materialise.js';
import { dirToWorld, toLocal, toWorld, bboxOf } from './frame.js';
import { GeoBuilder } from '../../viewer3d/mesh-builder.js';
import { makeMesh } from '../../viewer3d/model-util.js';
import { textureFor } from './pavements/view3d.js';

const BODY = [1, 1, 1];
const GLASS = [0.1, 0.13, 0.16];
const TYRE = [0.07, 0.07, 0.07];
const TRIM = [0.16, 0.17, 0.18];
const CAR_COLOURS = ['#e9eaec', '#c9ccd1', '#2b2e33', '#8d9299', '#f4f4f2', '#7b1f24', '#2f4a73', '#5c6166', '#b9b2a3', '#1d1f22'];

// Deterministic 0..1 from an integer.
const rnd = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

/** Collects quads and triangles with a colour each; build() gives a non indexed geometry with flat normals. */
function shapeBuilder() {
  const pos = []; const col = [];
  const tri = (a, b, c, k) => { pos.push(...a, ...b, ...c); col.push(...k, ...k, ...k); };
  const quad = (a, b, c, d, k) => { tri(a, b, c, k); tri(a, c, d, k); };
  // A box from (x0, y0, z0) to (x1, y1, z1) whose top can be inset (a tapered cabin): top = [tx0, tx1, tz0, tz1].
  const prism = (x0, x1, y0, y1, z0, z1, k, top = null, sideK = null) => {
    const [tx0, tx1, tz0, tz1] = top || [x0, x1, z0, z1];
    const b = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]];
    const t = [[tx0, y1, tz0], [tx1, y1, tz0], [tx1, y1, tz1], [tx0, y1, tz1]];
    const s = sideK || k;
    quad(t[3], t[2], t[1], t[0], k); // top
    quad(b[0], b[1], b[2], b[3], k); // bottom
    quad(b[1], b[0], t[0], t[1], s); // z0 side
    quad(b[3], b[2], t[2], t[3], s); // z1 side
    quad(b[0], b[3], t[3], t[0], s); // x0 end
    quad(b[2], b[1], t[1], t[2], s); // x1 end
  };
  const wheel = (cx, cz, r, w) => {
    const n = 10;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2; const a1 = ((i + 1) / n) * Math.PI * 2;
      const p = (a, z) => [cx + Math.cos(a) * r, r + Math.sin(a) * r, z];
      quad(p(a0, cz - w / 2), p(a1, cz - w / 2), p(a1, cz + w / 2), p(a0, cz + w / 2), TYRE);
      tri([cx, r, cz - w / 2], p(a1, cz - w / 2), p(a0, cz - w / 2), TRIM);
      tri([cx, r, cz + w / 2], p(a0, cz + w / 2), p(a1, cz + w / 2), TRIM);
    }
  };
  const build = () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    return g;
  };
  return { prism, wheel, quad, tri, build };
}

/** A generic hatchback, 4.4 m long along +x (front), 1.8 m wide, on the ground at y = 0. */
export function carGeometry() {
  const s = shapeBuilder();
  s.prism(-2.2, 2.2, 0.26, 0.82, -0.9, 0.9, BODY, [-2.14, 2.1, -0.86, 0.86]);
  s.prism(-2.2, 2.2, 0.2, 0.3, -0.88, 0.88, TRIM); // sill and bumpers
  s.prism(-1.75, 1.05, 0.82, 1.44, -0.84, 0.84, BODY, [-1.3, 0.35, -0.72, 0.72], GLASS); // cabin: glass sides, body roof
  for (const x of [-1.38, 1.36]) for (const z of [-0.84, 0.84]) s.wheel(x, z, 0.33, 0.2);
  return s.build();
}

/** A rigid truck with a box body, 8.6 m long along +x (cab at the front), 2.5 m wide. */
export function truckGeometry() {
  const s = shapeBuilder();
  s.prism(-4.3, 4.2, 0.55, 0.95, -1.05, 1.05, TRIM); // chassis
  s.prism(-4.3, 2.35, 0.95, 3.75, -1.24, 1.24, BODY); // box body
  s.prism(2.55, 4.3, 0.55, 1.75, -1.2, 1.2, BODY); // cab lower
  s.prism(2.55, 4.3, 1.75, 2.75, -1.2, 1.2, BODY, [2.6, 4.05, -1.14, 1.14], GLASS); // cab upper: glass all round, body roof
  for (const x of [-3.0, -1.85, 3.3]) for (const z of [-1.08, 1.08]) s.wheel(x, z, 0.5, 0.3);
  return s.build();
}

/** Where cars and trucks go for a commercial project: { cars: [{ x, y, ang, colour }], trucks: [{ x, y, ang }] } in plan mm and radians. */
export function entourageSpots(project) {
  const c = project?.commercial;
  const out = { cars: [], trucks: [] };
  if (project?.mode !== 'commercial' || !c) return out;
  const rows = [];
  try { rows.push(...parkingLayout(c).rows); } catch { /* no unit rows */ }
  try { rows.push(...buildingParking(c).rows); } catch { /* no building bays */ }
  let k = 0;
  let prev = false;
  for (const r of rows) {
    for (const s of r.slots || []) {
      k += 1;
      if (s.kind && s.kind !== 'bay') { prev = false; continue; }
      const p = s.poly;
      if (!p || p.length < 4) continue;
      // About one bay in three is taken, never three in a row, so the marking stays readable.
      const take = rnd(k * 7 + 3) < (prev ? 0.22 : 0.42);
      prev = take;
      if (!take) continue;
      const cx = (p[0].x + p[1].x + p[2].x + p[3].x) / 4;
      const cy = (p[0].y + p[1].y + p[2].y + p[3].y) / 4;
      // The bay runs from its aisle end (p0, p1) to its far end (p3, p2); nose in or reversed in.
      const dx = p[3].x - p[0].x; const dy = p[3].y - p[0].y;
      const flip = rnd(k * 13 + 1) < 0.3 ? Math.PI : 0;
      out.cars.push({ x: cx, y: cy, ang: Math.atan2(dy, dx) + flip, colour: CAR_COLOURS[Math.floor(rnd(k * 31 + 9) * CAR_COLOURS.length)] });
    }
  }
  // One truck backed up to a raised dock door of each building that has them (the first dock, so the others stay visible).
  for (const b of buildingsOf(c)) {
    let docks = [];
    try {
      const r = runBuilding(b, project);
      const byId = new Map(r.walls.map((w) => [w.id, w]));
      docks = r.openings.filter((o) => o.kind === 'roller_door' && (o.sill || 0) >= 900).map((o) => ({ o, w: byId.get(o.wallId) })).filter((d) => d.w);
    } catch { docks = []; }
    if (!docks.length) continue;
    const { o, w } = docks[0];
    const a = w.a || w.start; const e = w.b || w.end;
    if (!a || !e) continue;
    const L = Math.hypot(e.x - a.x, e.y - a.y) || 1;
    const u = { x: (e.x - a.x) / L, y: (e.y - a.y) / L };
    const at = { x: a.x + u.x * (o.offset + o.width / 2), y: a.y + u.y * (o.offset + o.width / 2) };
    // Outward: away from the building's middle.
    const ol = b.outline || [];
    const mid = ol.length ? { x: ol.reduce((t, q) => t + q.x, 0) / ol.length, y: ol.reduce((t, q) => t + q.y, 0) / ol.length } : { x: NaN, y: NaN };
    let n = { x: -u.y, y: u.x };
    const fwd = dirToWorld(b.place, { x: 0, y: -1 });
    if (Number.isFinite(mid.x) ? n.x * (at.x - mid.x) + n.y * (at.y - mid.y) < 0 : n.x * fwd.x + n.y * fwd.y < 0) n = { x: -n.x, y: -n.y };
    out.trucks.push({ x: at.x + n.x * 4600, y: at.y + n.y * 4600, ang: Math.atan2(n.y, n.x) });
  }
  return out;
}

/** Add the cars and trucks. Returns { cars, trucks } counts, or null when there is nothing to add. */
export function addCommercialEntourage(root, project, surf) {
  const spots = entourageSpots(project);
  if (!spots.cars.length && !spots.trucks.length) return null;
  const group = new THREE.Group();
  group.name = 'commercial-entourage';
  const o = new THREE.Object3D();
  const col = new THREE.Color();
  const put = (geo, list, name, colourOf) => {
    if (!list.length) return;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.15, envMapIntensity: 0.9 });
    mat.userData.shared = false;
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((s, i) => {
      const x = s.x / 1000; const z = s.y / 1000;
      o.position.set(x, surf(s.x, s.y) + 0.06, z);
      o.rotation.set(0, -s.ang, 0);
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
      mesh.setColorAt(i, col.set(colourOf(s, i)));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = { ground: true, extras: true, entourage: true };
    group.add(mesh);
  };
  put(carGeometry(), spots.cars, 'entourage-cars', (s) => s.colour);
  put(truckGeometry(), spots.trucks, 'entourage-trucks', () => '#f1f1ee');
  group.userData = { ground: true, extras: true };
  root.add(group);
  return { cars: spots.cars.length, trucks: spots.trucks.length };
}

const FORECOURT_KINDS = ['fuel-canopy', 'truck-canopy', 'pump-island', 'underground-tank-pad', 'air-water-bay'];

/**
 * A fuel canopy stands on a concrete forecourt: one slab under the canopies, pump islands and tank pad of each building that has a fuel
 * canopy, running back to the shop front and draped on the ground like the other pavements. 3D only (the plan shows the canopy, islands
 * and tank pad it covers). Returns the number of slabs.
 */
export function addForecourtSlabs(root, project, surf) {
  const c = project?.commercial;
  if (project?.mode !== 'commercial' || !c?.buildings?.length) return 0;
  const H = (xm, zm) => surf(xm * 1000, zm * 1000);
  const b = new GeoBuilder();
  let n = 0;
  for (const bd of buildingsOf(c)) {
    if (!bd.extras.some((e) => e.kind === 'fuel-canopy' || e.kind === 'truck-canopy')) continue;
    const loc = bd.extras.filter((e) => FORECOURT_KINDS.includes(e.kind)).flatMap((e) => e.polygon.map((q) => toLocal(bd.place, q)));
    const front = (bd.outline || []).map((q) => toLocal(bd.place, q)).filter((q) => Math.abs(q.y) < 1);
    const bb = bboxOf([...loc, ...front]);
    const m = 2500;
    const slab = [{ x: bb.minX - m, y: bb.minY - m }, { x: bb.maxX + m, y: bb.minY - m }, { x: bb.maxX + m, y: -150 }, { x: bb.minX - m, y: -150 }].map((q) => toWorld(bd.place, q));
    // A 1 m drape (finer than the car park pavements): the slab crosses the batter around the building pad.
    const [p0, p1, p2, p3] = slab.map((q) => ({ x: q.x / 1000, y: q.y / 1000 }));
    const nu = Math.max(1, Math.ceil(Math.hypot(p1.x - p0.x, p1.y - p0.y)));
    const nv = Math.max(1, Math.ceil(Math.hypot(p3.x - p0.x, p3.y - p0.y)));
    const P = (i, j) => {
      const s = i / nu; const t = j / nv;
      const ax = p0.x + (p1.x - p0.x) * s; const ay = p0.y + (p1.y - p0.y) * s;
      const bx = p3.x + (p2.x - p3.x) * s; const by = p3.y + (p2.y - p3.y) * s;
      const x = ax + (bx - ax) * t; const z = ay + (by - ay) * t;
      return { v: [x, H(x, z) + 0.035, z], uv: [(s * nu) / 4, (t * nv) / 4] };
    };
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      const a = P(i, j); const c2 = P(i + 1, j); const d = P(i + 1, j + 1); const f = P(i, j + 1);
      b.quad('concrete', a.v, c2.v, d.v, f.v, [a.uv, c2.uv, d.uv, f.uv], [0, 1, 0]);
    }
    n += 1;
  }
  if (!n) return 0;
  const tex = textureFor({ kind: 'concrete', base: '#c9c7c0', broom: true });
  const mat = new THREE.MeshStandardMaterial({ color: tex ? '#ffffff' : '#c9c7c0', map: tex || null, roughness: 0.94, metalness: 0, envMapIntensity: 0.25, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  mat.userData.shared = false;
  mat.userData.disposeMap = false;
  const mesh = makeMesh(b.build(), { concrete: mat }, { ground: true }, { cast: false, receive: true });
  if (!mesh) return 0;
  mesh.name = 'forecourt-slabs';
  mesh.userData = { ...mesh.userData, ground: true, extras: true, pavements: true };
  mesh.renderOrder = 1;
  root.add(mesh);
  return n;
}
