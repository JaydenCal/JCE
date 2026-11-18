// What makes the site read as a street and a garden in the 3D view, built from site.lot and the design (no extra data needed):
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
import { LIFT, KERB_PROFILE, KERB_LAYBACK_LIP, KERB_WIDTH } from './levels.js';
import { roadReserve, deriveDriveway, buildingHull, orientedBox } from '../site/lotplan.js';
import { addDrawnWays } from './pave3d.js';
import { pavementModel } from '../commercial/catalogue/pavements/logic.js';
import { buildingsOf } from '../commercial/catalogue/buildings.js';
import { frontFrame, houseSpec, toWorld, rng, ROOFS, WALLS } from '../site/neighbours.js';

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

/** Sample a plan line every ~step metres and also at the given distances (metres from the start), so a cut lands exactly on a vertex. */
export function sampleLineWithBreaks(line, step = 1.5, breaks = []) {
  const [a, b] = line;
  const len = Math.hypot(b.x - a.x, b.y - a.y) / 1000;
  const ts = new Set();
  const n = Math.max(1, Math.ceil(len / step));
  for (let i = 0; i <= n; i++) ts.add(i / n);
  for (const d of breaks) if (len > 0 && d > 0 && d < len) ts.add(d / len);
  return [...ts].sort((x, y) => x - y).map((t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }));
}

/** Height scale (0 = fully dropped, 1 = full kerb) at distance d metres along the kerb for a driveway crossover spanning [s0, s1] metres, with a ramp each side. */
export function kerbDropScale(d, span, ramp = 0.6) {
  if (!span) return 1;
  if (Array.isArray(span[0])) return span.reduce((m, sp) => Math.min(m, kerbDropScale(d, sp, ramp)), 1); // several crossovers: the lowest wins
  if (d >= span[0] && d <= span[1]) return 0;
  const k = d < span[0] ? span[0] - d : d - span[1];
  return Math.min(1, k / ramp);
}

export function addSiteExtras(ctx, root, project, surf, { extent = null, tm = null, realAerial = false, fds = null } = {}) {
  const lot = project.site?.lot;
  if (!lot?.boundary?.length) return null;
  const group = new THREE.Group();
  group.name = 'site-extras';
  root.add(group);
  const H = (xm, zm) => surf(xm * 1000, zm * 1000); // the ground as seen (design surface inside an element, the mesh elsewhere)
  const F = (xm, zm) => (fds || surf)(xm * 1000, zm * 1000); // the finished design surface: every road, path and drive surface is built on it
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
  const strip = (b, slot, A, B, lift, uvAlong = 3, uvAcross = 1, liftB = lift, level = F) => {
    let run = 0;
    const n = Math.min(A?.length || 0, B?.length || 0); // edge lines can be clipped to different counts; never read past the shorter one
    for (let i = 0; i + 1 < n; i++) {
      if (!A[i] || !A[i + 1] || !B[i] || !B[i + 1]) continue;
      const a0 = [A[i].x / 1000, 0, A[i].y / 1000];
      const a1 = [A[i + 1].x / 1000, 0, A[i + 1].y / 1000];
      const b0 = [B[i].x / 1000, 0, B[i].y / 1000];
      const b1 = [B[i + 1].x / 1000, 0, B[i + 1].y / 1000];
      a0[1] = level(a0[0], a0[2]) + lift;
      a1[1] = level(a1[0], a1[2]) + lift;
      b0[1] = level(b0[0], b0[2]) + liftB;
      b1[1] = level(b1[0], b1[2]) + liftB;
      const l0 = run / uvAlong;
      run += Math.hypot(a1[0] - a0[0], a1[2] - a0[2]);
      const l1 = run / uvAlong;
      b.quad(slot, a0, a1, b1, b0, [[l0, 0], [l1, 0], [l1, uvAcross], [l0, uvAcross]], [0, 1, 0]);
    }
  };
  
  // 1. Road reserve geometry only (no road surface is drawn: the aerial imagery is the only road, owner 18/11/2026) ---------------
  // The reserve is still needed to place the front door path and the driveway crossover end.
  const reserves = roadReserve(lot, { extendM: 60 });
  // A commercial site's drive is its own paved site works (asphalt), never the house driveway in concrete (owner 16/11/2026).
  const dw = layerOn(lot, 'driveway') && project.mode !== 'commercial' ? deriveDriveway(project) : null;
  const streetDirs = reserves;

  // 2. Driveway, crossover, path to the front door ------------------------------------------------------------------------
  const gravelDrive = (G.polygonArea(lot.boundary) || 0) / 1e6 >= 4000; // rural lots get a gravel drive
  const driveCentres = [];
  const drivePolys = [];
  {
    const b = new GeoBuilder();
    if (dw?.ok && !dw.manual) { // a saved drawn driveway is ignored (the tool is retired), in its own material
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
      strip(b, 'drive', left, right, LIFT.concrete, 3, 1);
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
          const P = t.map((i) => [contour[i].x, F(contour[i].x, contour[i].y) + LIFT.concrete, contour[i].y]);
          b.tri('drive', P[0], P[1], P[2], [P[0][0] / 3, P[0][2] / 3], [P[1][0] / 3, P[1][2] / 3], [P[2][0] / 3, P[2][2] / 3], [0, 1, 0]);
        }
      }
      driveCentres.push(c);
      drivePolys.push(dw.polygon);
    }
    // Driveways and roads drawn with the Road or pavement tool: one surface per material, draped, with fine edge lines.
    const drawn = addDrawnWays(project, surf);
    if (drawn?.mesh) { add(drawn.mesh); stats.driveway = true; stats.drawn = drawn.stats; for (const c of drawn.centres) driveCentres.push(c); }
    // front door path
    const door = project.mode === 'commercial' ? null : frontDoor(project, streetDirs[0] || reserves[0] || null, lot);
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
          strip(b, 'path', L, R, LIFT.concrete, 1.5, 1);
          driveCentres.push(pts);
        }
      }
    }
    if (!b.empty) {
      add(makeMesh(b.build(), {
        drive: gravelDrive ? mat('#a89f8c', { roughness: 1, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }) : concDrive ? mat('#ffffff', { map: concDrive, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }) : mat('#bdbab1', { polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
        path: conc ? mat('#ffffff', { map: conc, roughness: 0.92 }) : mat('#c3c0b7'),
      }, { ground: true }, { cast: false, receive: true, name: 'driveway' }));
    }
  }

  // 3. Garden beds and low bushes along the frontage ------------------------------------------------------------------------
  const bushSpots = [];
  const frontTrees = [];
  const frontEdges = (lot.frontEdges || []).filter((i) => Number.isInteger(i) && i >= 0 && i < lot.boundary.length);
  const subjectOn = layerOn(lot, 'fences');
  {
    const bBeds = new GeoBuilder();
    // A commercial site: planting never sits on a pavement (crossovers, aisles, bays, aprons), and the frontage strip carries trees too.
    let paved = [];
    if (project.mode === 'commercial' && project.commercial) {
      try {
        paved = [...pavementModel(project.commercial, lot).areas.map((a) => a.polygon), ...buildingsOf(project.commercial).flatMap((b) => [b.outline, ...(b.extras || []).map((e) => e.polygon)])].filter((q) => q?.length > 2);
      } catch { paved = []; }
    }
    const onPaved = (p, m = 600) => paved.some((poly) => G.pointInPolygon(p, poly) || poly.some((q, i) => G.projectToSegment(p, q, poly[(i + 1) % poly.length]).d < m));
    const clearOf = (p, rad) => !onPaved(p) && driveCentres.every((c) => c.every((q, i) => i % 2 || Math.hypot(q.x - p.x, q.y - p.y) > rad));
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
          strip(bBeds, 'mulch', mk(700), mk(1900), LIFT.mulchRaised, 2, 1, LIFT.mulchRaised, H);
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
    if (project.mode === 'commercial') {
      for (const ei of frontEdges.slice(0, 2)) {
        const a = lot.boundary[ei];
        const bb = lot.boundary[(ei + 1) % lot.boundary.length];
        const len = Math.hypot(bb.x - a.x, bb.y - a.y);
        if (len < 12000) continue;
        const u = G.norm({ x: bb.x - a.x, y: bb.y - a.y });
        let nIn = { x: -u.y, y: u.x };
        const mid = G.lerp(a, bb, 0.5);
        if (!G.pointInPolygon({ x: mid.x + nIn.x * 300, y: mid.y + nIn.y * 300 }, lot.boundary)) nIn = { x: -nIn.x, y: -nIn.y };
        const r = rng(41 + ei);
        const n = Math.max(1, Math.floor(len / 13000));
        for (let k = 0; k < n; k++) {
          const sAt = ((k + 0.5) / n) * len + (r() - 0.5) * 2500;
          const p = { x: a.x + u.x * sAt + nIn.x * 1500, y: a.y + u.y * sAt + nIn.y * 1500 };
          if (onPaved(p, 1800)) continue;
          frontTrees.push({ x: p.x / 1000, z: p.y / 1000, r: 1.5 + r() * 0.5, h: 4.6 + r() * 1.4, seed: 300 + ei * 20 + k });
        }
      }
    }
    // beds against the house front are left to the lawn; corner shrubs where fences meet the frontage add depth
    if (!bBeds.empty) add(makeMesh(bBeds.build(), { mulch: mat('#4d3a29', { roughness: 1 }) }, { ground: true }, { cast: false, receive: true, name: 'garden-beds' }));
  }

  // 4. Fences on the side and rear boundaries of the subject lot (Colorbond Shale Grey) -------------------------------------------
  if (subjectOn) {
    // A house lot has a timber post and rail fence on its lot lines (the homepage hero look); a commercial site keeps a steel panel fence.
    const timber = project.mode !== 'commercial';
    const b = new GeoBuilder();
    const n = lot.boundary.length;
    for (let i = 0; i < n; i++) {
      if (frontEdges.includes(i)) continue;
      const a = lot.boundary[i];
      const c = lot.boundary[(i + 1) % n];
      const len = Math.hypot(c.x - a.x, c.y - a.y) / 1000;
      const panels = Math.max(1, Math.round(len / (timber ? 2.7 : 2.35)));
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
        if (timber) {
          // two rails between posts, following the fall of the ground
          for (const rh of [0.5, 0.98]) addOrientedBox(b, mx, mz, hl + 0.035, 0.022, ang, ya + rh - 0.045, ya + rh + 0.045, 'cap');
          addOrientedBox(b, p1.x / 1000, p1.y / 1000, 0.055, 0.055, ang, y0, ya + 1.2, 'post');
        } else {
          addOrientedBox(b, mx, mz, hl, 0.018, ang, y0, ya + 1.8, 'sheet');
          addOrientedBox(b, mx, mz, hl, 0.03, ang, ya + 1.78, ya + 1.83, 'cap');
          addOrientedBox(b, p1.x / 1000, p1.y / 1000, 0.035, 0.04, ang, y0, ya + 1.85, 'post');
        }
        stats.fences++;
      }
      const p = a;
      const ya = H(p.x / 1000, p.y / 1000);
      if (timber) addOrientedBox(b, p.x / 1000, p.y / 1000, 0.055, 0.055, ang, ya - 0.06, ya + 1.2, 'post');
      else addOrientedBox(b, p.x / 1000, p.y / 1000, 0.035, 0.04, ang, ya - 0.06, ya + 1.85, 'post');
    }
    // A commercial site is fenced in a dark steel colour (security fencing); a house lot keeps the light Colorbond sheet.
    const fc = project.mode === 'commercial' ? { sheet: '#4a5056', cap: '#34383d', post: '#34383d' } : { sheet: '#8a6b47', cap: '#8a6b47', post: '#7a5d3d' };
    add(makeMesh(b.build(), { sheet: mat(fc.sheet, { roughness: timber ? 0.9 : 0.6, metalness: timber ? 0 : 0.25 }), cap: mat(fc.cap, { roughness: timber ? 0.9 : 0.6, metalness: timber ? 0 : 0.3 }), post: mat(fc.post, { roughness: timber ? 0.9 : 0.6, metalness: timber ? 0 : 0.3 }) }, { ground: true }, { cast: true, receive: true, name: 'fences' }));
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
    // Placement check: the letterbox never stands on or beside paving (a driveway mouth, a crossover, an aisle). Slide it along the frontage to clear ground.
    const pavedRings = [...(tm?.pavements?.areas || []).map((q) => q.polygon), dw?.polygon, dw?.crossover?.polygon, ...(dw?.extraPolygons || [])].filter((q) => q?.length > 2);
    const nearPaving = (q) => pavedRings.some((poly) => G.pointInPolygon(q, poly) || poly.some((v, i) => G.projectToSegment(q, v, poly[(i + 1) % poly.length]).d < 1500));
    let sPos = s;
    if (nearPaving({ x: a.x + u.x * sPos, y: a.y + u.y * sPos })) {
      sPos = null;
      for (let d = 1500; d < len && sPos == null; d += 1500) for (const cand of [s + d, s - d]) { if (cand > 1500 && cand < len - 1500 && !nearPaving({ x: a.x + u.x * cand, y: a.y + u.y * cand })) { sPos = cand; break; } }
    }
    if (sPos != null) {
    const p = { x: a.x + u.x * sPos, y: a.y + u.y * sPos };
    const ya = H(p.x / 1000, p.y / 1000);
    const b = new GeoBuilder();
    const ang = Math.atan2(u.y, u.x);
    addOrientedBox(b, p.x / 1000, p.y / 1000, 0.035, 0.035, ang, ya - 0.05, ya + 0.98, 'post');
    addOrientedBox(b, p.x / 1000, p.y / 1000, 0.22, 0.15, ang, ya + 0.98, ya + 1.24, 'box');
    addOrientedBox(b, p.x / 1000, p.y / 1000, 0.23, 0.16, ang, ya + 1.24, ya + 1.27, 'lid');
    add(makeMesh(b.build(), { post: mat('#33363a', { roughness: 0.5, metalness: 0.4 }), box: mat('#2f3236', { roughness: 0.45, metalness: 0.45 }), lid: mat('#7e8388', { roughness: 0.4, metalness: 0.6 }) }, { ground: true }, { cast: true, receive: false, name: 'letterbox' }));
    }
  }

  // 6. Neighbouring houses and trees --------------------------------------------------------------------------------------------
  const nbRings = [lot.boundary, ...(lot.neighbours || []).filter((n) => !n.isRoad && n.ring?.length > 2).map((n) => n.ring)];
  const rings = nbRings.map((r) => r.map(asArr));
  // With a real aerial under the scene the photograph already shows the existing houses, so no stand-in houses are drawn (owner 16/11/2026).
  const housesOn = !realAerial && (lot.source === 'sample' ? layerOn(lot, 'houses') : lot.layers?.houses === true);
  const treeSpots = [];
  // Around a commercial site the neighbours are drawn as plain industrial sheds, not houses.
  if (housesOn) (project.mode === 'commercial' ? buildNeighbourSheds : buildNeighbourHouses)(group, rings, H, stats, treeSpots);
  // Street trees are not drawn: the aerial shows the real road and verge, and a modelled verge tree could sit on it (owner 18/11/2026).
  treeSpots.push(...frontTrees);
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
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  mesh.name = 'bushes';
  group.add(mesh);
  stats.bushes = spots.length;
}

// A lumpy ball with vertex colours: dark underneath, light on top, a little patchy.
function foliageBlob(r, detail, squash = 1, phase = 0) {
  const g = new THREE.IcosahedronGeometry(r, detail);
  const p = g.attributes.position;
  const colors = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const bump = 1 + 0.12 * Math.sin(x * 5.1 / r + z * 3.3 / r + phase) * Math.cos(y * 4.2 / r + x * 2.1 / r);
    p.setXYZ(i, x * bump, y * bump * squash, z * bump);
    const t = (y / r + 1) / 2;
    const patch = 0.9 + 0.2 * (Math.sin((x * 7 + y * 3) / r + phase) * Math.cos(z * 6 / r) * 0.5 + 0.5);
    c.setScalar(0.62 + 0.55 * t).multiplyScalar(patch);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  return g;
}

// Instanced trees in the homepage hero look: a slender pale trunk with a few visible limbs under an open, airy eucalypt crown (loose leaf
// clumps with gaps, flattened, soft light-to-mid tones). Three seeded crown shapes, each tree picks one by its seed and gets its own
// size, lean and natural green (some grey-green), so the same site always looks the same. Unlit (no self shading), low poly for phones.
function seeded(n) { let a = (n >>> 0) + 0x9e3779b9; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function crownVariant(v) {
  const rnd = seeded(97 + v * 31);
  const n = [9, 11, 8][v];
  const clumps = [];
  for (let k = 0; k < n; k++) {
    const a = rnd() * Math.PI * 2;
    const rad = (v === 2 ? 0.2 + rnd() * 0.3 : 0.1 + rnd() * 0.42);
    const y = (v === 1 ? 0.62 + rnd() * 0.42 : 0.58 + rnd() * 0.38);
    clumps.push({ x: Math.cos(a) * rad, y, z: Math.sin(a) * rad, rr: 0.11 + rnd() * 0.07, sq: 0.5 + rnd() * 0.18, tone: 0.9 + (y - 0.58) * 0.45 + (rnd() - 0.5) * 0.1 });
  }
  const bark = [];
  const barkCol = (g, r, gg, b) => { const c = new Float32Array(g.attributes.position.count * 3); for (let i = 0; i < c.length; i += 3) { c[i] = r; c[i + 1] = gg; c[i + 2] = b; } g.setAttribute('color', new THREE.BufferAttribute(c, 3)); g.deleteAttribute('uv'); g.deleteAttribute('normal'); return g; };
  const trunk = new THREE.CylinderGeometry(0.035, 0.07, 0.72, 5, 1).toNonIndexed();
  trunk.translate(0, 0.36, 0);
  bark.push(barkCol(trunk, 0.74, 0.69, 0.62));
  for (let k = 0; k < Math.min(5, n); k++) {
    const c = clumps[k];
    const top = new THREE.Vector3(0, 0.5 + (k % 2) * 0.08, 0);
    const end = new THREE.Vector3(c.x * 0.85, 0.34 + c.y * 0.62 - 0.04, c.z * 0.85);
    const len = top.distanceTo(end);
    const limb = new THREE.CylinderGeometry(0.012, 0.028, len, 3, 1).toNonIndexed();
    limb.translate(0, len / 2, 0);
    limb.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.clone().sub(top).normalize()));
    limb.translate(top.x, top.y, top.z);
    bark.push(barkCol(limb, 0.7, 0.65, 0.58));
  }
  const leaf = clumps.map((c, k) => {
    const g = foliageBlob(c.rr * 1.25, 1, c.sq, k * 1.9 + v);
    const col = g.attributes.color;
    for (let i = 0; i < col.count; i++) col.setXYZ(i, Math.min(1.25, col.getX(i) * c.tone + 0.12), Math.min(1.25, col.getY(i) * c.tone + 0.12), Math.min(1.25, col.getZ(i) * c.tone + 0.12));
    g.translate(c.x, 0.34 + c.y * 0.7, c.z);
    return g;
  });
  return { bark: mergeGeometries(bark, false), leaf: mergeGeometries(leaf, false) };
}

function addTrees(group, spots, H, stats) {
  if (!spots.length) return;
  const GREENS = ['#7aa85a', '#86ad63', '#6f9a58', '#8fb06a', '#79a266', '#93ab7c', '#a0b48a', '#7d9f78']; // natural greens, the last few grey-green
  const o = new THREE.Object3D();
  const col = new THREE.Color();
  const barkMat = basic('#ffffff', { vertexColors: true });
  for (let v = 0; v < 3; v++) {
    const mine = spots.filter((s) => Math.abs(Math.floor(s.seed)) % 3 === v);
    if (!mine.length) continue;
    const { bark, leaf } = crownVariant(v);
    if (!bark || !leaf) continue;
    const lm = new THREE.InstancedMesh(leaf, basic('#ffffff', { vertexColors: true }), mine.length);
    const bm = new THREE.InstancedMesh(bark, barkMat, mine.length);
    mine.forEach((s, i) => {
      const rnd = seeded(Math.floor(s.seed * 7) + i);
      const wob = 0.82 + rnd() * 0.4;
      o.position.set(s.x, H(s.x, s.z) - 0.05, s.z);
      o.scale.set(s.r * 2 * wob, s.h * (0.86 + rnd() * 0.3), s.r * 2 * (1.15 - (wob - 0.82)));
      o.rotation.set((rnd() - 0.5) * 0.06, (s.seed * 2.399) % 6.28, (rnd() - 0.5) * 0.06);
      o.updateMatrix();
      lm.setMatrixAt(i, o.matrix);
      bm.setMatrixAt(i, o.matrix);
      col.set(GREENS[Math.floor(rnd() * GREENS.length)]);
      lm.setColorAt(i, col);
    });
    lm.instanceMatrix.needsUpdate = true;
    bm.instanceMatrix.needsUpdate = true;
    for (const [mesh, name] of [[lm, 'trees'], [bm, 'tree-trunks']]) {
      mesh.userData = { ground: true, extras: true };
      mesh.castShadow = true; // long tree shadows across the lawn and the road (the trees themselves stay unlit, with no self shading)
      mesh.receiveShadow = false;
      mesh.name = name;
      group.add(mesh);
    }
  }
  stats.trees = spots.length;
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
      treeSpots.push({ x: w[0], z: w[1], r, h: 4.2 + r * 1.5, seed: li * 7 + t });
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

// Neighbouring industrial sheds as massing (commercial sites): a clad box with a low gable roof, a darker dado and roller doors on the
// street face. One merged mesh for all of them. Sized from each neighbouring lot, set back from its street edge for a yard and parking.
const SHED_WALLS = ['#d3d6d8', '#c2c7cc', '#d6d0c0', '#b3bab5', '#9aa2aa', '#e2e1dc'];
function buildNeighbourSheds(group, rings, H, stats) {
  const b = new GeoBuilder();
  for (let li = 1; li < rings.length; li++) {
    const f = frontFrame(rings, li);
    if (!(f.W > 16) || !(f.depth > 24)) continue;
    const r = rng(900 + li);
    const hw = Math.min(f.W - 10, f.W * (0.44 + 0.16 * r()), 44);
    const hd = Math.min(f.depth - 20, f.depth * (0.32 + 0.14 * r()), 48);
    const setback = Math.max(11, f.depth * 0.16 + r() * 4);
    const eaveH = 5.2 + r() * 1.8;
    const slot = `w${Math.floor(r() * SHED_WALLS.length)}`;
    const T = (a, d, y) => { const w = toWorld(f, a, d); return [w[0], y, w[1]]; };
    const N = (a, d) => [a * f.ux + d * f.nx, 0, a * f.uy + d * f.ny];
    const c = [[-hw / 2, setback], [hw / 2, setback], [hw / 2, setback + hd], [-hw / 2, setback + hd]];
    const gY = c.map(([a, d]) => { const p = T(a, d, 0); return H(p[0], p[2]); });
    const lo = Math.min(...gY) - 0.15;
    const fl = Math.max(...gY) + 0.1;
    const top = fl + eaveH;
    const rise = (hw / 2) * Math.tan((5 * Math.PI) / 180);
    const wall = (i, j, n) => {
      b.quad('dado', T(c[i][0], c[i][1], lo), T(c[j][0], c[j][1], lo), T(c[j][0], c[j][1], fl + 1.1), T(c[i][0], c[i][1], fl + 1.1), [[0, 0], [1, 0], [1, 1], [0, 1]], n);
      b.quad(slot, T(c[i][0], c[i][1], fl + 1.1), T(c[j][0], c[j][1], fl + 1.1), T(c[j][0], c[j][1], top), T(c[i][0], c[i][1], top), [[0, 0], [1, 0], [1, 1], [0, 1]], n);
    };
    wall(0, 1, N(0, -1)); wall(1, 2, N(1, 0)); wall(2, 3, N(0, 1)); wall(3, 0, N(-1, 0));
    // gable ends front and rear, ridge running back from the street
    for (const [d, sg] of [[setback, -1], [setback + hd, 1]]) b.tri(slot, T(-hw / 2, d, top), T(hw / 2, d, top), T(0, d, top + rise), [0, 0], [1, 0], [0.5, 1], N(0, sg));
    const o = 0.3;
    const k = Math.cos(Math.atan(rise / (hw / 2)));
    const sn = Math.sin(Math.atan(rise / (hw / 2)));
    const eY = top - (o * rise) / (hw / 2);
    for (const sg of [-1, 1]) {
      const n = N(sg, 0);
      b.quad('roof', T(sg * (hw / 2 + o), setback - o, eY), T(sg * (hw / 2 + o), setback + hd + o, eY), T(0, setback + hd + o, top + rise), T(0, setback - o, top + rise), [[0, 0], [1, 0], [1, 1], [0, 1]], [n[0] * sn, k, n[2] * sn]);
    }
    // roller doors on the street face
    const nd = Math.max(1, Math.min(4, Math.floor(hw / 12)));
    for (let i = 0; i < nd; i++) {
      const a = (-0.5 + (i + 0.5) / nd) * hw * 0.8;
      b.quad('door', T(a - 2.2, setback - 0.04, fl), T(a + 2.2, setback - 0.04, fl), T(a + 2.2, setback - 0.04, fl + 4.6), T(a - 2.2, setback - 0.04, fl + 4.6), [[0, 0], [1, 0], [1, 1], [0, 1]], N(0, -1));
    }
    stats.houses++;
  }
  if (b.empty) return;
  const mats = { dado: mat('#a9a8a2', { roughness: 0.95 }), roof: mat('#959ba1', { roughness: 0.7, metalness: 0.1, side: THREE.DoubleSide }), door: mat('#5b636b', { roughness: 0.6, metalness: 0.2 }) };
  SHED_WALLS.forEach((col, i) => { mats[`w${i}`] = mat(col, { roughness: 0.7, metalness: 0.15 }); });
  add2(group, makeMesh(b.build(), mats, { ground: true }, { cast: true, receive: true, name: 'neighbour-sheds' }));
}

function add2(group, mesh) {
  if (!mesh) return;
  mesh.userData = { ...mesh.userData, ground: true, extras: true };
  group.add(mesh);
}
