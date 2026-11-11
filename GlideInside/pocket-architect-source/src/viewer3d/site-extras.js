// What makes the site read as a street and a garden in the 3D view, built from site.lot and the design (no extra data needed):
//   * the road: asphalt with a faint centre line, concrete gutter, a roll top kerb, the footpath and street trees on the verge,
//   * the driveway (from the lot planner's driveway path) with its crossover, the path to the front door, a letterbox,
//   * garden beds with low bushes along the frontage and Colorbond fences on the side and rear boundaries,
//   * neighbouring houses as tidy massing models (hip roof, eaves, windows, garage door) and trees at the rear of each lot,
//   * a soft contact shadow under the house.
// Everything is flagged `ground` so it never changes the framing of the camera or the sun's shadow box. Trees, foliage and
// glass are unlit (MeshBasicMaterial) so they read crisp, as the owner asked. Plan mm in, metres out; surf(xMm, yMm) -> Y metres.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as G from '../model/geometry.js';
import { GeoBuilder, addOrientedBox } from './mesh-builder.js';
import { makeMesh } from './model-util.js';
import { layerOn } from './site-geom.js';
import { roadReserve, deriveDriveway, buildingHull, orientedBox } from '../site/lotplan.js';
import { frontFrame, houseSpec, toWorld, rng, streetTreeSpots, ROOFS, WALLS } from '../site/neighbours.js';

const hasDom = typeof document !== 'undefined';
const texCache = new Map(); // module level: textures are shared between rebuilds and never disposed with a model

function canvasTex(key, size, draw, { repeat = null, aniso = 16 } = {}) {
  if (!hasDom) return null;
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  texCache.set(key, t);
  return t;
}

function noise(g, size, count, palette, alpha, px = 1.4) {
  let s = 12345;
  const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < count; i++) {
    g.globalAlpha = alpha * (0.3 + r() * 0.7);
    g.fillStyle = palette[Math.floor(r() * palette.length)];
    g.fillRect(r() * size, r() * size, px * (0.6 + r()), px * (0.6 + r()));
  }
  g.globalAlpha = 1;
}

const asphaltTex = () => canvasTex('asphalt', 512, (g, n) => {
  g.fillStyle = '#44474a';
  g.fillRect(0, 0, n, n);
  noise(g, n, 9000, ['#3a3d40', '#505357', '#4a4d51', '#5b5e62', '#34373a'], 0.55, 1.6);
  noise(g, n, 90, ['#2c2e30', '#6a6d70'], 0.35, 3);
});
// One tile = 3 m by 3 m with control joints on the edges (concrete drive and path).
const concreteTex = (base, key) => canvasTex(key, 512, (g, n) => {
  g.fillStyle = base;
  g.fillRect(0, 0, n, n);
  noise(g, n, 6000, ['#a9a69d', '#cfccc3', '#bbb8ae', '#c4c1b7'], 0.35, 1.5);
  g.fillStyle = 'rgba(60,58,52,0.55)';
  g.fillRect(0, 0, n, 3);
  g.fillRect(0, 0, 3, n);
});

// ---------------------------------------------------------------------------------------------------------------------------
function mat(color, opts = {}) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, envMapIntensity: 0.3, ...opts });
  m.userData.shared = false;
  if (m.map) m.userData.disposeMap = false;
  return m;
}
function basic(color, opts = {}) {
  const m = new THREE.MeshBasicMaterial({ color, ...opts });
  m.userData.shared = false;
  return m;
}

const asArr = (p) => [p.x / 1000, p.y / 1000];

// Straight line a-b (plan mm), clipped to the terrain extent. Returns [a, b] or null.
function clipLine(a, b, ext) {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const edge = (p, q) => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  const m = 600;
  if (!(edge(-dx, a.x - (ext.x0 + m)) && edge(dx, ext.x1 - m - a.x) && edge(-dy, a.y - (ext.y0 + m)) && edge(dy, ext.y1 - m - a.y))) return null;
  return [{ x: a.x + dx * t0, y: a.y + dy * t0 }, { x: a.x + dx * t1, y: a.y + dy * t1 }];
}

// Points along a plan line every ~step metres: [{x, y}] plan mm.
function sampleLine(line, step = 1.5) {
  const [a, b] = line;
  const len = Math.hypot(b.x - a.x, b.y - a.y) / 1000;
  const n = Math.max(1, Math.ceil(len / step));
  return Array.from({ length: n + 1 }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n }));
}

export function addSiteExtras(ctx, root, project, surf, { extent = null, tm = null } = {}) {
  const lot = project.site?.lot;
  if (!lot?.boundary?.length) return null;
  const group = new THREE.Group();
  group.name = 'site-extras';
  root.add(group);
  const H = (xm, zm) => surf(xm * 1000, zm * 1000);
  const add = (mesh) => {
    if (!mesh) return;
    mesh.userData = { ...mesh.userData, ground: true, extras: true };
    group.add(mesh);
  };
  const stats = { road: false, driveway: false, fences: 0, houses: 0, trees: 0, bushes: 0 };
  const asphalt = asphaltTex();
  const conc = concreteTex('#c3c0b7', 'concrete-path');
  const concDrive = concreteTex('#bdbab1', 'concrete-drive');

  // Strip between two lines of plan points sampled at the same parameter: quads draped on the surface.
  const strip = (b, slot, A, B, lift, uvAlong = 3, uvAcross = 1, liftB = lift) => {
    let run = 0;
    for (let i = 0; i + 1 < A.length; i++) {
      const a0 = [A[i].x / 1000, 0, A[i].y / 1000];
      const a1 = [A[i + 1].x / 1000, 0, A[i + 1].y / 1000];
      const b0 = [B[i].x / 1000, 0, B[i].y / 1000];
      const b1 = [B[i + 1].x / 1000, 0, B[i + 1].y / 1000];
      a0[1] = H(a0[0], a0[2]) + lift;
      a1[1] = H(a1[0], a1[2]) + lift;
      b0[1] = H(b0[0], b0[2]) + liftB;
      b1[1] = H(b1[0], b1[2]) + liftB;
      const l0 = run / uvAlong;
      run += Math.hypot(a1[0] - a0[0], a1[2] - a0[2]);
      const l1 = run / uvAlong;
      b.quad(slot, a0, a1, b1, b0, [[l0, 0], [l1, 0], [l1, uvAcross], [l0, uvAcross]], [0, 1, 0]);
    }
  };
  
  // 1. Road, kerb, footpath ------------------------------------------------------------------------------------------------
  const reserves = layerOn(lot, 'road') ? roadReserve(lot, { extendM: 400 }) : [];
  const streetDirs = [];
  if (reserves.length && extent) {
    const b = new GeoBuilder();
    for (const r of reserves) {
      const L = r.lines;
      const clip = (ln) => clipLine(ln[0], ln[1], extent);
      const lines = Object.fromEntries(Object.entries(L).map(([k, v]) => [k, clip(v)]));
      if (Object.values(lines).some((v) => !v)) continue;
      streetDirs.push(r);
      const S = (k, step = 1.5) => sampleLine(lines[k], step);
      // carriageway and the gutter strip
      strip(b, 'asphalt', S('gutter'), S('farGutter'), 0.025, 6, 1);
      strip(b, 'gutter', S('kerb', 2), S('gutter', 2), 0.012, 3, 0.15);
      strip(b, 'gutter', S('farGutter', 2), S('farKerb', 2), 0.012, 3, 0.15);
      // roll top kerb: profile across the line (t metres out from the kerb face towards the property, height m)
      const prof = [[0, 0.015], [0.015, 0.1], [0.06, 0.145], [0.13, 0.155], [0.2, 0.14], [0.25, 0.09], [0.3, 0.045], [0.34, 0.03]];
      const kerbLine = (name, dir) => {
        const pts = S(name, 1.5);
        const out = prof.map(([t, h]) => ({ off: t * dir, h }));
        for (let k = 0; k + 1 < out.length; k++) {
          const u = r.outward;
          for (let i = 0; i + 1 < pts.length; i++) {
            const P = (p, o) => [(p.x - u.x * o.off * 1000) / 1000, 0, (p.y - u.y * o.off * 1000) / 1000];
            const p0 = P(pts[i], out[k]);
            const p1 = P(pts[i + 1], out[k]);
            const q0 = P(pts[i], out[k + 1]);
            const q1 = P(pts[i + 1], out[k + 1]);
            p0[1] = H(p0[0], p0[2]) + out[k].h;
            p1[1] = H(p1[0], p1[2]) + out[k].h;
            q0[1] = H(q0[0], q0[2]) + out[k + 1].h;
            q1[1] = H(q1[0], q1[2]) + out[k + 1].h;
            b.quad('kerb', p0, p1, q1, q0, undefined, [0, 1, 0]);
          }
        }
      };
      kerbLine('kerb', 1);
      // far kerb mirrors it (profile towards the far verge)
      {
        const pts = S('farKerb', 1.5);
        for (let k = 0; k + 1 < prof.length; k++) {
          for (let i = 0; i + 1 < pts.length; i++) {
            const P = (p, t) => [(p.x + r.outward.x * t * 1000) / 1000, 0, (p.y + r.outward.y * t * 1000) / 1000];
            const p0 = P(pts[i], prof[k][0]);
            const p1 = P(pts[i + 1], prof[k][0]);
            const q0 = P(pts[i], prof[k + 1][0]);
            const q1 = P(pts[i + 1], prof[k + 1][0]);
            p0[1] = H(p0[0], p0[2]) + prof[k][1];
            p1[1] = H(p1[0], p1[2]) + prof[k][1];
            q0[1] = H(q0[0], q0[2]) + prof[k + 1][1];
            q1[1] = H(q1[0], q1[2]) + prof[k + 1][1];
            b.quad('kerb', p0, p1, q1, q0, undefined, [0, 1, 0]);
          }
        }
      }
      // footpath: between the near and far footpath lines
      strip(b, 'path', S('footpathNear', 2), S('footpathFar', 2), 0.04, 1.5, 1);
      // faint centre line, dashed
      const c = S('centreline', 0.5);
      for (let i = 0; i + 1 < c.length; i++) {
        if (i % 12 > 5) continue;
        const dx = c[i + 1].x - c[i].x;
        const dy = c[i + 1].y - c[i].y;
        const l = Math.hypot(dx, dy) || 1;
        const nx = (-dy / l) * 55;
        const ny = (dx / l) * 55;
        strip(b, 'line', [{ x: c[i].x + nx, y: c[i].y + ny }, { x: c[i + 1].x + nx, y: c[i + 1].y + ny }], [{ x: c[i].x - nx, y: c[i].y - ny }, { x: c[i + 1].x - nx, y: c[i + 1].y - ny }], 0.033, 1, 1);
      }
    }
    if (!b.empty) {
      const pathMat = mat('#ffffff', { map: conc, roughness: 0.92 });
      add(makeMesh(b.build(), {
        asphalt: asphalt ? mat('#ffffff', { map: asphalt, roughness: 0.95 }) : mat('#45484b', { roughness: 0.95 }),
        gutter: mat('#a3a19a', { roughness: 0.9 }),
        kerb: mat('#b4b2aa', { roughness: 0.85 }),
        path: conc ? pathMat : mat('#c3c0b7'),
        line: mat('#ece6cf', { roughness: 0.8, transparent: true, opacity: 0.55, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      }, { ground: true }, { cast: false, receive: true, name: 'road' }));
      stats.road = true;
    }
  }

  // 2. Driveway, crossover, path to the front door ------------------------------------------------------------------------
  const dw = layerOn(lot, 'driveway') ? deriveDriveway(project) : null;
  const driveCentres = [];
  const drivePolys = [];
  {
    const b = new GeoBuilder();
    if (dw?.ok) {
      stats.driveway = true;
      const half = dw.widthMm / 2;
      const left = [];
      const right = [];
      const c = dw.centre;
      for (let i = 0; i < c.length; i++) {
        const p = c[i];
        const q = c[Math.min(c.length - 1, i + 1)];
        const o = c[Math.max(0, i - 1)];
        const t = G.norm({ x: q.x - o.x, y: q.y - o.y });
        left.push({ x: p.x - t.y * half, y: p.y + t.x * half });
        right.push({ x: p.x + t.y * half, y: p.y - t.x * half });
      }
      strip(b, 'drive', left, right, 0.05, 3, 1);
      // splayed crossover over the verge: its outline is the driveway polygon's end
      const co = dw.crossover.polygon;
      if (co?.length > 3) {
        const contour = co.map((p) => new THREE.Vector2(p.x / 1000, p.y / 1000));
        let tris = [];
        try {
          tris = THREE.ShapeUtils.triangulateShape(contour, []);
        } catch {
          tris = [];
        }
        for (const t of tris) {
          const P = t.map((i) => [contour[i].x, H(contour[i].x, contour[i].y) + 0.052, contour[i].y]);
          b.tri('drive', P[0], P[1], P[2], [P[0][0] / 3, P[0][2] / 3], [P[1][0] / 3, P[1][2] / 3], [P[2][0] / 3, P[2][2] / 3], [0, 1, 0]);
        }
      }
      driveCentres.push(c);
      drivePolys.push(dw.polygon);
    }
    // front door path
    const door = frontDoor(project, streetDirs[0] || reserves[0] || null, lot);
    if (door) {
      const prop = (reserves[0] || streetDirs[0])?.lines?.property;
      if (prop) {
        const out = door.normal;
        const A = G.add(door.mid, G.mul(out, 150));
        // run out along the door normal to the property line
        const t = rayLine(A, out, prop[0], prop[1]);
        if (t != null && t > 0 && t < 40000) {
          const B = G.add(A, G.mul(out, t));
          const pts = sampleLine([A, B], 1);
          const hw = 500;
          const L = pts.map((p) => ({ x: p.x - out.y * hw, y: p.y + out.x * hw }));
          const R = pts.map((p) => ({ x: p.x + out.y * hw, y: p.y - out.x * hw }));
          strip(b, 'path', L, R, 0.045, 1.5, 1);
          driveCentres.push(pts);
        }
      }
    }
    if (!b.empty) {
      add(makeMesh(b.build(), {
        drive: concDrive ? mat('#ffffff', { map: concDrive, roughness: 0.9 }) : mat('#bdbab1'),
        path: conc ? mat('#ffffff', { map: conc, roughness: 0.92 }) : mat('#c3c0b7'),
      }, { ground: true }, { cast: false, receive: true, name: 'driveway' }));
    }
  }

  // 3. Garden beds and low bushes along the frontage ------------------------------------------------------------------------
  const bushSpots = [];
  const frontEdges = (lot.frontEdges || []).filter((i) => Number.isInteger(i) && i >= 0 && i < lot.boundary.length);
  const subjectOn = layerOn(lot, 'fences');
  {
    const bBeds = new GeoBuilder();
    const clearOf = (p, rad) => driveCentres.every((c) => c.every((q, i) => i % 2 || Math.hypot(q.x - p.x, q.y - p.y) > rad));
    for (const ei of frontEdges.slice(0, 2)) {
      const a = lot.boundary[ei];
      const bb = lot.boundary[(ei + 1) % lot.boundary.length];
      const len = Math.hypot(bb.x - a.x, bb.y - a.y);
      if (len < 4000) continue;
      const u = G.norm({ x: bb.x - a.x, y: bb.y - a.y });
      let nIn = { x: -u.y, y: u.x };
      const mid = G.lerp(a, bb, 0.5);
      if (!G.pointInPolygon({ x: mid.x + nIn.x * 300, y: mid.y + nIn.y * 300 }, lot.boundary)) nIn = { x: -nIn.x, y: -nIn.y };
      const rad = (dw?.widthMm || 3000) / 2 + 700;
      let run = [];
      const flush = () => {
        if (run.length > 2) {
          const mk = (off) => run.map((p) => ({ x: p.x + nIn.x * off, y: p.y + nIn.y * off }));
          strip(bBeds, 'mulch', mk(700), mk(1900), 0.03, 2, 1);
        }
        run = [];
      };
      const steps = Math.floor(len / 500);
      for (let i = 0; i <= steps; i++) {
        const p = { x: a.x + u.x * i * 500, y: a.y + u.y * i * 500 };
        const inMargin = i * 500 < 900 || len - i * 500 < 900;
        if (inMargin || !clearOf(p, rad) || !clearOf({ x: p.x + nIn.x * 1300, y: p.y + nIn.y * 1300 }, rad)) flush();
        else run.push(p);
      }
      flush();
      // bushes: one every 1.1 to 1.9 m along the bed, set in the middle, a few taller
      const r = rng(5 + ei);
      for (let s = 900; s < len - 900; s += 1100 + r() * 800) {
        const p = { x: a.x + u.x * s + nIn.x * 1300, y: a.y + u.y * s + nIn.y * 1300 };
        if (!clearOf(p, rad)) continue;
        bushSpots.push({ x: p.x / 1000, z: p.y / 1000, r: 0.35 + r() * 0.35, h: r() > 0.8 ? 1.1 : 0.5 + r() * 0.35, seed: r() });
      }
    }
    // beds against the house front are left to the lawn; corner shrubs where fences meet the frontage add depth
    if (!bBeds.empty) add(makeMesh(bBeds.build(), { mulch: mat('#4d3a29', { roughness: 1 }) }, { ground: true }, { cast: false, receive: true, name: 'garden-beds' }));
  }

  // 4. Fences on the side and rear boundaries of the subject lot (Colorbond Shale Grey) -------------------------------------------
  if (subjectOn) {
    const b = new GeoBuilder();
    const n = lot.boundary.length;
    for (let i = 0; i < n; i++) {
      if (frontEdges.includes(i)) continue;
      const a = lot.boundary[i];
      const c = lot.boundary[(i + 1) % n];
      const len = Math.hypot(c.x - a.x, c.y - a.y) / 1000;
      const panels = Math.max(1, Math.round(len / 2.35));
      const ang = Math.atan2(c.y - a.y, c.x - a.x);
      for (let k = 0; k < panels; k++) {
        const t0 = k / panels;
        const t1 = (k + 1) / panels;
        const p0 = { x: a.x + (c.x - a.x) * t0, y: a.y + (c.y - a.y) * t0 };
        const p1 = { x: a.x + (c.x - a.x) * t1, y: a.y + (c.y - a.y) * t1 };
        const y0 = Math.min(H(p0.x / 1000, p0.y / 1000), H(p1.x / 1000, p1.y / 1000)) - 0.06;
        const ya = (H(p0.x / 1000, p0.y / 1000) + H(p1.x / 1000, p1.y / 1000)) / 2;
        const mx = (p0.x + p1.x) / 2000;
        const mz = (p0.y + p1.y) / 2000;
        const hl = (len / panels) / 2 - 0.035;
        addOrientedBox(b, mx, mz, hl, 0.018, ang, y0, ya + 1.8, 'sheet');
        addOrientedBox(b, mx, mz, hl, 0.03, ang, ya + 1.78, ya + 1.83, 'cap');
        addOrientedBox(b, p1.x / 1000, p1.y / 1000, 0.035, 0.04, ang, y0, ya + 1.85, 'post');
        stats.fences++;
      }
      const p = a;
      const ya = H(p.x / 1000, p.y / 1000);
      addOrientedBox(b, p.x / 1000, p.y / 1000, 0.035, 0.04, ang, ya - 0.06, ya + 1.85, 'post');
    }
    add(makeMesh(b.build(), { sheet: mat('#cdc9bb', { roughness: 0.6, metalness: 0.25 }), cap: mat('#9a978b', { roughness: 0.6, metalness: 0.3 }), post: mat('#8e8b80', { roughness: 0.6, metalness: 0.3 }) }, { ground: true }, { cast: true, receive: true, name: 'fences' }));
  }

  // 5. Letterbox on the frontage, clear of the drive ---------------------------------------------------------------------------
  if (frontEdges.length) {
    const ei = frontEdges[0];
    const a = lot.boundary[ei];
    const c = lot.boundary[(ei + 1) % lot.boundary.length];
    const len = G.dist(a, c);
    const u = G.norm({ x: c.x - a.x, y: c.y - a.y });
    const driveSide = dw?.ok ? G.dot(G.sub(dw.kerbPoint, a), u) : len / 2;
    const s = driveSide > len / 2 ? Math.max(1500, driveSide - dw.widthMm / 2 - 1500) : Math.min(len - 1500, driveSide + (dw?.widthMm || 3000) / 2 + 1500);
    const p = { x: a.x + u.x * s, y: a.y + u.y * s };
    const ya = H(p.x / 1000, p.y / 1000);
    const b = new GeoBuilder();
    const ang = Math.atan2(u.y, u.x);
    addOrientedBox(b, p.x / 1000, p.y / 1000, 0.035, 0.035, ang, ya - 0.05, ya + 0.98, 'post');
    addOrientedBox(b, p.x / 1000, p.y / 1000, 0.22, 0.15, ang, ya + 0.98, ya + 1.24, 'box');
    addOrientedBox(b, p.x / 1000, p.y / 1000, 0.23, 0.16, ang, ya + 1.24, ya + 1.27, 'lid');
    add(makeMesh(b.build(), { post: mat('#33363a', { roughness: 0.5, metalness: 0.4 }), box: mat('#2f3236', { roughness: 0.45, metalness: 0.45 }), lid: mat('#7e8388', { roughness: 0.4, metalness: 0.6 }) }, { ground: true }, { cast: true, receive: false, name: 'letterbox' }));
  }

  // 6. Neighbouring houses and trees --------------------------------------------------------------------------------------------
  const nbRings = [lot.boundary, ...(lot.neighbours || []).filter((n) => !n.isRoad && n.ring?.length > 2).map((n) => n.ring)];
  const rings = nbRings.map((r) => r.map(asArr));
  const housesOn = lot.source === 'sample' ? layerOn(lot, 'houses') : lot.layers?.houses === true;
  const treeSpots = [];
  if (housesOn) buildNeighbourHouses(group, rings, H, stats, treeSpots);
  if (reserves.length || housesOn) {
    for (const t of streetTreeSpots(rings)) {
      const x = t.x * 1000;
      const y = t.y * 1000;
      if (extent && (x < extent.x0 + 2000 || x > extent.x1 - 2000 || y < extent.y0 + 2000 || y > extent.y1 - 2000)) continue;
      // keep clear of the lot's own driveway and the roads' lines
      if (driveCentres.some((c) => c.some((q, i) => !(i % 2) && Math.hypot(q.x - x, q.y - y) < 2600))) continue;
      treeSpots.push({ x: t.x, z: t.y, r: t.r, h: t.h, seed: t.seed });
    }
  }
  addTrees(group, treeSpots, H, stats);
  addBushes(group, bushSpots, H, stats);

  // 7. Soft contact shadow under the house ---------------------------------------------------------------------------------------
  if (hasDom && tm) {
    const hull = buildingHull(project);
    const box = hull.length > 2 ? orientedBox(hull) : null;
    if (box) {
      const tex = canvasTex('contact', 128, (g, n) => {
        const grad = g.createRadialGradient(n / 2, n / 2, n * 0.18, n / 2, n / 2, n / 2);
        grad.addColorStop(0, 'rgba(0,0,0,0.55)');
        grad.addColorStop(0.55, 'rgba(0,0,0,0.30)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        g.clearRect(0, 0, n, n);
        g.fillStyle = grad;
        g.fillRect(0, 0, n, n);
      }, { aniso: 4 });
      const w = box.w / 1000 + 3.0;
      const d = box.d / 1000 + 3.0;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), basic('#000000', { map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
      m.rotation.set(-Math.PI / 2, 0, 0);
      // plane local X along the box's u axis (world direction (ux, 0, uy)); rotate about world Y after laying it flat
      const holder = new THREE.Group();
      holder.add(m);
      holder.rotation.y = -Math.atan2(box.u.y, box.u.x);
      holder.position.set(box.centre.x / 1000, tm.padY + 0.012, box.centre.y / 1000);
      m.userData = { ground: true, extras: true };
      m.renderOrder = 1;
      holder.userData = { ground: true, extras: true };
      group.add(holder);
    }
  }
  return stats;
}

// Ray from point A along unit direction d to the infinite line p-q: distance (mm) or null.
function rayLine(A, d, p, q) {
  const e = { x: q.x - p.x, y: q.y - p.y };
  const den = d.x * e.y - d.y * e.x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((p.x - A.x) * e.y - (p.y - A.y) * e.x) / den;
  return t;
}

// The exterior door of the ground floor that faces the street best (a person's front door), not a garage door.
export function frontDoor(project, reserve, lot) {
  const level = [...(project.levels || [])].sort((a, b) => a.elevation - b.elevation)[0];
  if (!level) return null;
  const rs = reserve || roadReserve(lot)[0];
  if (!rs) return null;
  const hull = buildingHull(project);
  const centroid = hull.length ? G.polygonCentroid(hull) : { x: 0, y: 0 };
  let best = null;
  for (const o of level.openings || []) {
    if (o.kind !== 'door' || o.status === 'demolish') continue;
    const w = (level.walls || []).find((x) => x.id === o.wallId);
    if (!w || w.kind !== 'exterior' || G.wallLength(w) < 1) continue;
    const mid = G.pointOnWall(w, o.offset);
    const n = G.wallNormal(w);
    let out;
    if (w.outside === 1) out = n;
    else if (w.outside === -1) out = { x: -n.x, y: -n.y };
    else out = G.dot(n, G.sub(mid, centroid)) >= 0 ? n : { x: -n.x, y: -n.y };
    out = G.norm(out);
    const score = G.dot(out, rs.outward);
    if (score > 0.7 && (!best || score > best.score)) best = { score, mid, normal: out };
  }
  return best;
}

// Instanced low bushes: flattened icospheres with their shading painted in (unlit, so they stay crisp).
function addBushes(group, spots, H, stats) {
  if (!spots.length) return;
  const geo = foliageBlob(1, 2, 0.55);
  const m = basic('#ffffff', { vertexColors: true });
  const mesh = new THREE.InstancedMesh(geo, m, spots.length);
  const GREENS = ['#4c7f3b', '#5a8c42', '#3c6a33', '#6e9948', '#4a7a3a'];
  const o = new THREE.Object3D();
  const col = new THREE.Color();
  spots.forEach((s, i) => {
    o.position.set(s.x, H(s.x, s.z) + s.h * 0.35, s.z);
    o.scale.set(s.r, s.h, s.r);
    o.rotation.set(0, s.seed * 6.28, 0);
    o.updateMatrix();
    mesh.setMatrixAt(i, o.matrix);
    col.set(GREENS[Math.floor(s.seed * 97) % GREENS.length]).offsetHSL(0, 0, (s.seed - 0.5) * 0.08);
    mesh.setColorAt(i, col);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.userData = { ground: true, extras: true };
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.name = 'bushes';
  group.add(mesh);
  stats.bushes = spots.length;
}

// A lumpy ball with vertex colours: dark underneath, light on top, a little patchy.
function foliageBlob(r, detail, squash = 1) {
  const g = new THREE.IcosahedronGeometry(r, detail);
  const p = g.attributes.position;
  const colors = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const bump = 1 + 0.09 * Math.sin(x * 5.1 + z * 3.3) * Math.cos(y * 4.2 + x * 2.1);
    p.setXYZ(i, x * bump, y * bump * squash, z * bump);
    const t = (y / r + 1) / 2;
    const patch = 0.92 + 0.16 * (Math.sin(x * 7 + y * 3) * Math.cos(z * 6) * 0.5 + 0.5);
    c.setScalar(0.5 + 0.62 * t).multiplyScalar(patch);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  return g;
}

// Instanced trees: a trunk and a canopy of four overlapping blobs, one merged geometry. Canopy radius r, height h (metres).
function addTrees(group, spots, H, stats) {
  if (!spots.length) return;
  const trunk = new THREE.CylinderGeometry(0.1, 0.17, 1, 7, 1);
  trunk.translate(0, 0.5, 0);
  const tc = new Float32Array(trunk.attributes.position.count * 3);
  for (let i = 0; i < tc.length; i += 3) {
    tc[i] = 0.36;
    tc[i + 1] = 0.27;
    tc[i + 2] = 0.2;
  }
  trunk.setAttribute('color', new THREE.BufferAttribute(tc, 3));
  trunk.deleteAttribute('uv');
  trunk.deleteAttribute('normal');
  const blobs = [[0, 0.62, 0, 0.5], [0.35, 0.5, 0.1, 0.38], [-0.3, 0.55, -0.15, 0.4], [0.05, 0.84, 0.05, 0.36]].map(([x, y, z, rr]) => {
    const b = foliageBlob(rr, 2, 0.9);
    b.translate(x, y, z);
    return b;
  });
  // trunk height 0.45 of the tree; canopy sits above (heights are fractions of h)
  const geo = mergeGeometries([trunk.clone().scale(1, 0.55, 1), ...blobs.map((b) => b)], false);
  const m = basic('#ffffff', { vertexColors: true });
  const mesh = new THREE.InstancedMesh(geo, m, spots.length);
  const GREENS = ['#3f7436', '#4d8340', '#35692f', '#5b8f44', '#487b3a', '#6b9448'];
  const o = new THREE.Object3D();
  const col = new THREE.Color();
  spots.forEach((s, i) => {
    o.position.set(s.x, H(s.x, s.z) - 0.05, s.z);
    o.scale.set(s.r * 2, s.h, s.r * 2);
    o.rotation.set(0, (s.seed * 2.399) % 6.28, 0);
    o.updateMatrix();
    mesh.setMatrixAt(i, o.matrix);
    col.set(GREENS[Math.floor(Math.abs(Math.sin(s.seed * 12.9898)) * 1000) % GREENS.length]);
    mesh.setColorAt(i, col);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.userData = { ground: true, extras: true };
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.name = 'trees';
  group.add(mesh);
  stats.trees = spots.length;
  trunk.dispose();
}

// Neighbour house as massing: walls, a hip roof with eaves, a lower garage wing, windows, front door and a garage door.
function buildNeighbourHouses(group, rings, H, stats, treeSpots) {
  const wallB = new GeoBuilder();
  const roofB = new GeoBuilder();
  const glassB = new GeoBuilder();
  const trimB = new GeoBuilder();
  for (let li = 1; li < rings.length; li++) {
    const f = frontFrame(rings, li);
    const spec = houseSpec(f.W, f.depth, li);
    const { hw, hd, setback, side } = spec;
    const T = (a, b, y) => {
      const w = toWorld(f, a, b);
      return [w[0], y, w[1]];
    };
    const dir = (a, b) => [a * f.ux + b * f.nx, 0, a * f.uy + b * f.ny]; // local horizontal direction -> world
    const nrm = (a, b, y) => {
      const d = dir(a, b);
      return [d[0], y, d[2]];
    };
    const corners = [[-hw / 2, setback], [hw / 2, setback], [hw / 2, setback + hd], [-hw / 2, setback + hd]];
    const gY = corners.map(([a, b]) => { const p = T(a, b, 0); return H(p[0], p[2]); });
    const lo = Math.min(...gY) - 0.15;
    const floor = Math.max(...gY) + 0.12;
    const wallTop = floor + (spec.storeys === 2 ? 5.4 : 2.7);
    const wallColour = WALLS[spec.wallIdx];
    // walls: four faces plus the base
    const face = (a0, b0, a1, b1, y0, y1, n) => wallB.quad(`w${spec.wallIdx}`, T(a0, b0, y0), T(a1, b1, y0), T(a1, b1, y1), T(a0, b0, y1), [[0, y0], [1, y0], [1, y1], [0, y1]], n);
    const [c0, c1, c2, c3] = corners;
    face(c0[0], c0[1], c1[0], c1[1], lo, wallTop, nrm(0, -1, 0));
    face(c1[0], c1[1], c2[0], c2[1], lo, wallTop, nrm(1, 0, 0));
    face(c2[0], c2[1], c3[0], c3[1], lo, wallTop, nrm(0, 1, 0));
    face(c3[0], c3[1], c0[0], c0[1], lo, wallTop, nrm(-1, 0, 0));
    // hip roof, eaves 0.5 m out, 22 degree pitch, ridge along the front edge direction
    const eave = 0.5;
    const ea = hw / 2 + eave;
    const eb0 = setback - eave;
    const eb1 = setback + hd + eave;
    const rise = Math.tan((22 * Math.PI) / 180);
    const halfSpan = (hd + 2 * eave) / 2;
    const ridgeY = wallTop - 0.12 + halfSpan * rise;
    const eaveY = wallTop - 0.12;
    const bm = (eb0 + eb1) / 2;
    const rl = Math.max(0.4, ea - halfSpan); // half length of the ridge
    const ridgeA = [-rl, rl];
    const sl = `r${spec.roofIdx}`;
    const slopeN = (ax, bz) => {
      const d = dir(ax, bz);
      const k = Math.cos(Math.atan(rise));
      return [d[0] * Math.sin(Math.atan(rise)), k, d[2] * Math.sin(Math.atan(rise))];
    };
    // front (street side) and back slopes
    roofB.quad(sl, T(-ea, eb0, eaveY), T(ea, eb0, eaveY), T(ridgeA[1], bm, ridgeY), T(ridgeA[0], bm, ridgeY), [[0, 0], [1, 0], [1, 1], [0, 1]], slopeN(0, -1));
    roofB.quad(sl, T(ea, eb1, eaveY), T(-ea, eb1, eaveY), T(ridgeA[0], bm, ridgeY), T(ridgeA[1], bm, ridgeY), [[0, 0], [1, 0], [1, 1], [0, 1]], slopeN(0, 1));
    // hips
    roofB.tri(sl, T(ea, eb0, eaveY), T(ea, eb1, eaveY), T(ridgeA[1], bm, ridgeY), [0, 0], [1, 0], [0.5, 1], slopeN(1, 0));
    roofB.tri(sl, T(-ea, eb1, eaveY), T(-ea, eb0, eaveY), T(ridgeA[0], bm, ridgeY), [0, 0], [1, 0], [0.5, 1], slopeN(-1, 0));
    // eaves underside (soffit) so the roof reads as a solid
    roofB.quad('soffit', T(-ea, eb0, eaveY - 0.02), T(ea, eb0, eaveY - 0.02), T(ea, eb1, eaveY - 0.02), T(-ea, eb1, eaveY - 0.02), [[0, 0], [1, 0], [1, 1], [0, 1]], [0, -1, 0]);
    // fascia: a thin band along the eaves line
    const fz = [[-ea, eb0, ea, eb0, 0, -1], [ea, eb0, ea, eb1, 1, 0], [ea, eb1, -ea, eb1, 0, 1], [-ea, eb1, -ea, eb0, -1, 0]];
    for (const [a0, b0, a1, b1, na, nb] of fz) {
      trimB.quad('fascia', T(a0, b0, eaveY - 0.18), T(a1, b1, eaveY - 0.18), T(a1, b1, eaveY + 0.02), T(a0, b0, eaveY + 0.02), [[0, 0], [1, 0], [1, 1], [0, 1]], nrm(na, nb, 0));
    }
    // garage wing at the street end, lower, hipped: dx0 is the same as the sample aerial
    const dw = 3.4;
    const dx0 = side * (hw / 2 - dw / 2 - 0.4);
    const ga = [dx0 - 3.2, dx0 + 3.2];
    const gb = [setback - 1.6, setback + 4.5];
    const gTop = floor + 2.55;
    const gq = (a0, b0, a1, b1, n) => wallB.quad(`w${spec.wallIdx}`, T(a0, b0, lo), T(a1, b1, lo), T(a1, b1, gTop), T(a0, b0, gTop), [[0, 0], [1, 0], [1, 1], [0, 1]], n);
    gq(ga[0], gb[0], ga[1], gb[0], nrm(0, -1, 0));
    gq(ga[1], gb[0], ga[1], gb[1], nrm(1, 0, 0));
    gq(ga[0], gb[1], ga[0], gb[0], nrm(-1, 0, 0));
    const gRise = Math.tan((18 * Math.PI) / 180);
    const gMid = (ga[0] + ga[1]) / 2;
    const gHalf = (ga[1] - ga[0]) / 2 + eave;
    const gRidge = gTop + gHalf * gRise;
    // gable ended garage: ridge runs front to back
    const gs = (a, na) => [dir(na, 0)[0] * Math.sin(Math.atan(gRise)), Math.cos(Math.atan(gRise)), dir(na, 0)[2] * Math.sin(Math.atan(gRise))];
    roofB.quad(sl, T(ga[0] - eave, gb[0] - eave, gTop), T(ga[0] - eave, gb[1], gTop), T(gMid, gb[1], gRidge), T(gMid, gb[0] - eave, gRidge), [[0, 0], [1, 0], [1, 1], [0, 1]], gs(0, -1));
    roofB.quad(sl, T(ga[1] + eave, gb[1], gTop), T(ga[1] + eave, gb[0] - eave, gTop), T(gMid, gb[0] - eave, gRidge), T(gMid, gb[1], gRidge), [[0, 0], [1, 0], [1, 1], [0, 1]], gs(0, 1));
    wallB.tri(`w${spec.wallIdx}`, T(ga[0] - eave, gb[0] - eave, gTop), T(ga[1] + eave, gb[0] - eave, gTop), T(gMid, gb[0] - eave, gRidge), [0, 0], [1, 0], [0.5, 1], nrm(0, -1, 0));
    // garage door and entry door on the street faces, windows on the front and sides
    const q = (b, slot, a0, a1, y0, y1, bPos, n, lift = 0.015) => b.quad(slot, T(a0, bPos, y0), T(a1, bPos, y0), T(a1, bPos, y1), T(a0, bPos, y1), [[0, 0], [1, 0], [1, 1], [0, 1]], n, lift);
    q(trimB, 'garagedoor', gMid - 2.4, gMid + 2.4, floor, floor + 2.1, gb[0] - 0.012, nrm(0, -1, 0));
    const fr = [-hw / 2 + 1.6, -hw / 2 + 5, hw / 2 - 5, hw / 2 - 1.6].map((a) => Math.min(Math.max(a, -hw / 2 + 0.8), hw / 2 - 0.8));
    const front = side > 0 ? [fr[0], fr[1]] : [fr[2], fr[3]];
    for (const a of [...new Set(front)]) q(glassB, 'glass', a - 0.9, a + 0.9, floor + 0.95, floor + 2.05, setback - 0.012, nrm(0, -1, 0));
    q(trimB, 'door', -side * hw * 0.18 - 0.5, -side * hw * 0.18 + 0.5, floor, floor + 2.05, setback - 0.012, nrm(0, -1, 0));
    for (const a of [-hw / 4, hw / 4]) q(glassB, 'glass', a - 1.0, a + 1.0, floor + 0.95, floor + 2.05, setback + hd + 0.012, nrm(0, 1, 0));
    // side windows
    for (const bpos of [setback + hd * 0.3, setback + hd * 0.7]) {
      glassB.quad('glass', T(hw / 2 + 0.012, bpos - 0.8, floor + 0.95), T(hw / 2 + 0.012, bpos + 0.8, floor + 0.95), T(hw / 2 + 0.012, bpos + 0.8, floor + 2.05), T(hw / 2 + 0.012, bpos - 0.8, floor + 2.05), [[0, 0], [1, 0], [1, 1], [0, 1]], nrm(1, 0, 0));
    }
    stats.houses++;
    // rear trees (same spots as the sample aerial) and a shed
    const rand = rng(500 + li);
    for (let t = 0; t < 3; t++) {
      const ta = (rand() - 0.5) * f.W * 0.8;
      const tb = setback + hd + 3 + rand() * Math.max(2, f.depth - setback - hd - 6);
      const r = 1.7 + rand() * 1.8;
      const w = toWorld(f, ta, tb);
      treeSpots.push({ x: w[0], z: w[1], r, h: 5 + r * 1.6, seed: li * 7 + t });
    }
    // shed: box with a skillion roof
    const sx = -side * (f.W * 0.28);
    const sY = H(...(() => { const w = toWorld(f, sx, f.depth - 3.7); return [w[0], w[1]]; })());
    const sc = [[sx - 1.6, f.depth - 5], [sx + 1.6, f.depth - 5], [sx + 1.6, f.depth - 2.4], [sx - 1.6, f.depth - 2.4]];
    const sq = (i, j, n) => wallB.quad('shed', T(sc[i][0], sc[i][1], sY - 0.1), T(sc[j][0], sc[j][1], sY - 0.1), T(sc[j][0], sc[j][1], sY + 2.3), T(sc[i][0], sc[i][1], sY + 2.3), [[0, 0], [1, 0], [1, 1], [0, 1]], n);
    sq(0, 1, nrm(0, -1, 0));
    sq(1, 2, nrm(1, 0, 0));
    sq(2, 3, nrm(0, 1, 0));
    sq(3, 0, nrm(-1, 0, 0));
    roofB.quad('shedroof', T(sx - 1.8, f.depth - 5.2, sY + 2.3), T(sx + 1.8, f.depth - 5.2, sY + 2.3), T(sx + 1.8, f.depth - 2.2, sY + 2.55), T(sx - 1.8, f.depth - 2.2, sY + 2.55), [[0, 0], [1, 0], [1, 1], [0, 1]], [0, 1, 0]);
  }
  const wallMats = {};
  WALLS.forEach((c, i) => { wallMats[`w${i}`] = mat(c, { roughness: 0.95 }); });
  const roofMats2 = {};
  ROOFS.forEach(([c], i) => { roofMats2[`r${i}`] = mat(c, { roughness: 0.5, metalness: 0.25, side: THREE.DoubleSide }); });
  if (!wallB.empty) add2(group, makeMesh(wallB.build(), { ...wallMats, shed: mat('#7a7f82', { roughness: 0.6, metalness: 0.2 }) }, { ground: true }, { cast: true, receive: true, name: 'neighbour-walls' }));
  if (!roofB.empty) add2(group, makeMesh(roofB.build(), { ...roofMats2, soffit: mat('#d8d3c6'), shedroof: mat('#5d6266', { roughness: 0.5, metalness: 0.3 }) }, { ground: true }, { cast: true, receive: true, name: 'neighbour-roofs' }));
  if (!trimB.empty) add2(group, makeMesh(trimB.build(), { fascia: mat('#4a4f54', { roughness: 0.5, metalness: 0.2 }), garagedoor: mat('#d9d6cc', { roughness: 0.6 }), door: mat('#3d4b5c', { roughness: 0.6 }) }, { ground: true }, { cast: false, receive: false, name: 'neighbour-trim' }));
  if (!glassB.empty) add2(group, makeMesh(glassB.build(), { glass: basic('#8fb0c6', { side: THREE.DoubleSide }) }, { ground: true }, { cast: false, receive: false, name: 'neighbour-windows' }));
}

function add2(group, mesh) {
  if (!mesh) return;
  mesh.userData = { ...mesh.userData, ground: true, extras: true };
  group.add(mesh);
}
