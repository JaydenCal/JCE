// 3D for the commercial pavements: draped pavement areas with canvas textures, kerb extrusions from the kerb profiles, paint markings
// (bay lines, accessible symbol and hatch, crossing, arrows, give way and stop bars), wheel stops and speed humps. Built from
// pavementModel(project.commercial, lot). Everything is flagged `ground` so it never changes the camera framing or the sun's shadow box.
// Textures are canvas drawn at 1024 px with mipmaps and 16x anisotropy so they stay crisp (no blur), and are cached at module level,
// the same pattern as src/viewer3d/site-extras.js. Plan mm in, metres out; surf(xMm, yMm) -> Y metres.

import * as THREE from 'three';
import { GeoBuilder, addOrientedBox } from '../../../viewer3d/mesh-builder.js';
import { makeMesh } from '../../../viewer3d/model-util.js';
import { pavementModel } from './logic.js';
import { pavementById } from './pavements.js';
import { kerbById, profileArea } from './kerbs.js';
import { markingGeometry, markingById, drawAccessibleIcon, PAINT } from './markings.js';

const hasDom = typeof document !== 'undefined';
const texCache = new Map();

function canvasTex(key, size, draw, { aniso = 16, repeat = true } = {}) {
  if (!hasDom) return null;
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = aniso;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  texCache.set(key, t);
  return t;
}

// Deterministic noise (same stream every time, so a rebuild looks identical).
function rngFrom(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function speckle(g, size, count, palette, alpha, px, seed) {
  const r = rngFrom(seed);
  for (let i = 0; i < count; i++) {
    g.globalAlpha = alpha * (0.3 + r() * 0.7);
    g.fillStyle = palette[Math.floor(r() * palette.length)];
    const w = px * (0.6 + r() * 0.9);
    const h = px * (0.6 + r() * 0.9);
    const x = r() * size;
    const y = r() * size;
    g.fillRect(x, y, w, h);
    // wrap so the tile has no seam
    if (x + w > size) g.fillRect(x - size, y, w, h);
    if (y + h > size) g.fillRect(x, y - size, w, h);
  }
  g.globalAlpha = 1;
}
const shade = (hex, f) => {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
};

const DRAW = {
  concrete(g, n, t) {
    g.fillStyle = t.base; g.fillRect(0, 0, n, n);
    const r = rngFrom(7);
    for (let i = 0; i < 14; i++) { g.globalAlpha = 0.016; g.fillStyle = r() > 0.5 ? '#ffffff' : '#77746e'; g.fillRect(r() * n - 120, r() * n - 120, 240 + r() * 200, 240 + r() * 200); }
    g.globalAlpha = 1;
    speckle(g, n, 14000, ['#a9a69d', '#d3d0c7', '#bbb8ae', '#c4c1b7', '#8f8c83'], 0.32, 2.2, 11);
    if (t.broom) { g.strokeStyle = 'rgba(70,66,58,0.05)'; g.lineWidth = 1; for (let y = 0; y < n; y += 3) { g.beginPath(); g.moveTo(0, y + (y % 7) * 0.2); g.lineTo(n, y); g.stroke(); } }
    // control joints on the tile edges: a dark saw cut with a light lip
    g.fillStyle = 'rgba(52,50,44,0.62)'; g.fillRect(0, 0, n, 4); g.fillRect(0, 0, 4, n);
    g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(0, 4, n, 2); g.fillRect(4, 0, 2, n);
  },
  asphalt(g, n, t) {
    g.fillStyle = t.base; g.fillRect(0, 0, n, n);
    const px = t.coarse ? 3.2 : 2.2;
    speckle(g, n, t.coarse ? 22000 : 30000, [shade(t.base, 0.8), shade(t.base, 1.15), shade(t.base, 1.3), shade(t.base, 0.65), shade(t.base, 1.45)], 0.55, px, 21);
    speckle(g, n, 260, ['#26282a', '#76797c'], 0.35, 6, 22);
    const r = rngFrom(23);
    for (let i = 0; i < 5; i++) { g.globalAlpha = 0.02; g.fillStyle = '#111'; g.fillRect(r() * n - 100, r() * n - 100, 200 + r() * 200, 200 + r() * 200); }
    g.globalAlpha = 1;
  },
  seal(g, n, t) {
    g.fillStyle = shade(t.base, 0.7); g.fillRect(0, 0, n, n);
    speckle(g, n, 16000, ['#8d8b85', '#a29f97', '#74726d', '#b3afa5', '#615f5b'], 0.85, 5, 31);
    speckle(g, n, 7000, ['#999690', '#84827c', '#aaa69c'], 0.8, 3, 32);
  },
  gravel(g, n, t) {
    g.fillStyle = shade(t.base, 0.78); g.fillRect(0, 0, n, n);
    const r = rngFrom(41);
    const pal = ['#b2a58b', '#9c8f77', '#c4b89f', '#8a7e69', '#d0c6af', '#a89b81', '#7d7260'];
    for (let i = 0; i < 5200; i++) {
      const rad = 2 + r() * 4.2;
      const x = r() * n; const y = r() * n;
      g.fillStyle = 'rgba(40,34,24,0.35)'; g.beginPath(); g.arc(x + 1, y + 1.2, rad, 0, Math.PI * 2); g.fill();
      g.fillStyle = pal[Math.floor(r() * pal.length)]; g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
    }
  },
  permeable(g, n, t) {
    // 200 x 100 mm pavers in running bond with open joints; the tile is 2.4 m (1 mm = 0.4267 px)
    g.fillStyle = '#5d5c58'; g.fillRect(0, 0, n, n);
    speckle(g, n, 9000, ['#7a7975', '#4c4b48', '#8b8a85'], 0.7, 2, 51);
    const k = n / 2400; const w = 200 * k; const h = 100 * k; const gap = 7 * k;
    const r = rngFrom(52);
    for (let row = 0; row * h < n; row++) {
      const off = row % 2 ? w / 2 : 0;
      for (let col = -1; col * w < n; col++) {
        const x = col * w + off; const y = row * h;
        g.fillStyle = shade(t.base, 0.88 + r() * 0.22); g.fillRect(x + gap / 2, y + gap / 2, w - gap, h - gap);
        g.fillStyle = 'rgba(255,255,255,0.10)'; g.fillRect(x + gap / 2, y + gap / 2, w - gap, 1.4);
      }
    }
  },
  pavers(g, n, t) {
    g.fillStyle = '#b8ad9a'; g.fillRect(0, 0, n, n);
    const k = n / 2400; const w = 230 * k; const h = 115 * k; const gap = 4 * k;
    const r = rngFrom(61);
    for (let row = 0; row * h < n; row++) {
      const off = row % 2 ? w / 2 : 0;
      for (let col = -1; col * w < n; col++) {
        const x = col * w + off; const y = row * h;
        g.fillStyle = shade(t.base, 0.86 + r() * 0.26); g.fillRect(x + gap / 2, y + gap / 2, w - gap, h - gap);
      }
    }
    speckle(g, n, 7000, ['#8f826f', '#cdbfa8'], 0.18, 1.6, 62);
  },
  aggregate(g, n, t) {
    g.fillStyle = shade(t.base, 0.85); g.fillRect(0, 0, n, n);
    const r = rngFrom(71);
    const pal = ['#c7b79a', '#a39278', '#d8d0bf', '#8d7f69', '#b8a98b', '#e0d9c8', '#9a8c75'];
    for (let i = 0; i < 6500; i++) {
      const rad = 2.4 + r() * 3.8;
      g.fillStyle = pal[Math.floor(r() * pal.length)];
      g.beginPath(); g.ellipse(r() * n, r() * n, rad, rad * (0.7 + r() * 0.3), r() * 3, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = 'rgba(50,44,34,0.55)'; g.fillRect(0, 0, n, 4); g.fillRect(0, 0, 4, n);
  },
  kerb(g, n) {
    g.fillStyle = '#b9b7ae'; g.fillRect(0, 0, n, n);
    speckle(g, n, 2600, ['#a29f96', '#cbc8bf', '#aaa79e'], 0.4, 1.6, 81);
  },
};

export const textureFor = (t3d, size = 1024) => (DRAW[t3d.kind] ? canvasTex(`pav:${t3d.kind}:${t3d.base}:${t3d.coarse ? 'c' : ''}:${t3d.broom ? 'b' : ''}`, size, (g, n) => DRAW[t3d.kind](g, n, t3d)) : null);
const accessibleTex = () => canvasTex('pav:accessible', 256, (g, n) => drawAccessibleIcon(g, n / 2, n / 2, n), { repeat: false, aniso: 8 });
const kerbTex = () => canvasTex('pav:kerb', 256, (g, n) => DRAW.kerb(g, n));

function mat(color, opts = {}) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0, envMapIntensity: 0.25, ...opts });
  m.userData.shared = false;
  if (m.map) m.userData.disposeMap = false; // cached textures outlive a rebuild
  return m;
}

// Geometry ---------------------------------------------------------------------------------------------------------------------------

const GROUND = 0.025; // pavement surface above the graded ground, m: one level for every asphalt and concrete piece, flush with the road asphalt (site-extras 0.025)
const PAINT_LIFT = 0.012; // paint above the pavement
const SEG_M = 3; // drape grid

/** Add one pavement polygon to the builder, draped on the ground, with UVs aligned to the polygon's first edge. */
export function addArea(b, slot, poly, H, tileM) {
  const p0 = poly[0];
  const e = { x: poly[1].x - p0.x, y: poly[1].y - p0.y };
  const el = Math.hypot(e.x, e.y) || 1;
  const ux = e.x / el; const uy = e.y / el;
  const uv = (xm, zm) => { const dx = xm - p0.x / 1000; const dz = zm - p0.y / 1000; return [(dx * ux + dz * uy) / tileM, (-dx * uy + dz * ux) / tileM]; };
  const V = (xm, zm) => [xm, H(xm, zm) + GROUND, zm];
  const m = poly.map((p) => ({ x: p.x / 1000, y: p.y / 1000 }));
  const convexQuad = poly.length === 4;
  if (convexQuad) {
    const L1 = Math.hypot(m[1].x - m[0].x, m[1].y - m[0].y);
    const L2 = Math.hypot(m[3].x - m[0].x, m[3].y - m[0].y);
    const nu = Math.max(1, Math.ceil(L1 / SEG_M));
    const nv = Math.max(1, Math.ceil(L2 / SEG_M));
    const P = (i, j) => {
      const s = i / nu; const t = j / nv;
      const ax = m[0].x + (m[1].x - m[0].x) * s; const ay = m[0].y + (m[1].y - m[0].y) * s;
      const bx = m[3].x + (m[2].x - m[3].x) * s; const by = m[3].y + (m[2].y - m[3].y) * s;
      return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t };
    };
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nv; j++) {
        const a = P(i, j); const c = P(i + 1, j); const d = P(i + 1, j + 1); const f = P(i, j + 1);
        b.quad(slot, V(a.x, a.y), V(c.x, c.y), V(d.x, d.y), V(f.x, f.y), [uv(a.x, a.y), uv(c.x, c.y), uv(d.x, d.y), uv(f.x, f.y)], [0, 1, 0]);
      }
    }
    return;
  }
  const contour = m.map((p) => new THREE.Vector2(p.x, p.y));
  let tris = [];
  try { tris = THREE.ShapeUtils.triangulateShape(contour, []); } catch { tris = []; }
  for (const [i, j, k] of tris) b.tri(slot, V(m[i].x, m[i].y), V(m[j].x, m[j].y), V(m[k].x, m[k].y), uv(m[i].x, m[i].y), uv(m[j].x, m[j].y), uv(m[k].x, m[k].y), [0, 1, 0]);
}

/** Extrude a kerb profile along a polyline. Profile x runs along n = (-dy, dx), the landscaping side. */
function addKerb(b, slot, kerb, polyline, H) {
  const prof = kerb.profile;
  const ccw = profileArea(prof) > 0;
  for (let i = 0; i + 1 < polyline.length; i++) {
    const a = polyline[i]; const c = polyline[i + 1];
    const dx = c.x - a.x; const dy = c.y - a.y;
    const L = Math.hypot(dx, dy);
    if (L < 1) continue;
    const tx = dx / L; const tz = dy / L;
    const nx = -tz; const nz = tx;
    const base = (p, off) => [(p.x + nx * off) / 1000, 0, (p.y + nz * off) / 1000];
    const at = (p, pr) => { const q = base(p, pr.x); q[1] = H(q[0], q[2]) + GROUND + pr.y / 1000; return q; };
    for (let k = 0; k < prof.length; k++) {
      const p0 = prof[k]; const p1 = prof[(k + 1) % prof.length];
      const ex = p1.x - p0.x; const ey = p1.y - p0.y;
      const el = Math.hypot(ex, ey);
      if (el < 1) continue;
      // outward normal of this profile edge in (x across, y up), turned into world
      const o = ccw ? { x: ey / el, y: -ex / el } : { x: -ey / el, y: ex / el };
      const hint = [nx * o.x, o.y, nz * o.x];
      b.quad(slot, at(a, p0), at(c, p0), at(c, p1), at(a, p1), [[0, p0.y / 1000], [L / 1000, p0.y / 1000], [L / 1000, p1.y / 1000], [0, p1.y / 1000]], hint);
    }
    // end caps
    const cap = (p, sgn) => {
      const pts = prof.map((pr) => at(p, pr));
      const hint = [tx * sgn, 0, tz * sgn];
      for (let k = 1; k < pts.length - 1; k++) b.tri(slot, pts[0], pts[k], pts[k + 1], [0, 0], [0, 0], [0, 0], hint);
    };
    cap(a, -1); cap(c, 1);
  }
}

function addPaint(b, slot, poly, H, lift) {
  const pts = poly.map((p) => { const x = p.x / 1000; const z = p.y / 1000; return [x, H(x, z) + GROUND + lift, z]; });
  if (pts.length < 3) return;
  b.poly(slot, pts, pts.map((q) => [q[0], q[2]]), [0, 1, 0]);
}

function addHump(b, slot, s, H) {
  const L = s.lengthMm / 1000; const W = s.widthMm / 1000; const h = s.heightMm / 1000;
  const a = (s.rotationDeg * Math.PI) / 180;
  const c = Math.cos(a); const sn = Math.sin(a);
  const cx = s.centre.x / 1000; const cz = s.centre.y / 1000;
  const y0 = H(cx, cz) + GROUND;
  const P = (u, v, y) => [cx + c * u - sn * v, y0 + y, cz + sn * u + c * v];
  const ramp = Math.min(0.9, L / 4);
  const prof = [[-L / 2, 0], [-L / 2 + ramp, h], [L / 2 - ramp, h], [L / 2, 0]];
  for (let i = 0; i + 1 < prof.length; i++) {
    const [u0, y0a] = prof[i]; const [u1, y1a] = prof[i + 1];
    b.quad(slot, P(u0, -W / 2, y0a), P(u1, -W / 2, y1a), P(u1, W / 2, y1a), P(u0, W / 2, y0a), [[0, 0], [1, 0], [1, 1], [0, 1]], [0, 1, 0]);
  }
  b.poly(slot, [P(-L / 2, -W / 2, 0), P(-L / 2 + ramp, -W / 2, h), P(L / 2 - ramp, -W / 2, h), P(L / 2, -W / 2, 0)], [[0, 0], [1, 0], [1, 1], [0, 1]], [-sn, 0, c]);
  b.poly(slot, [P(-L / 2, W / 2, 0), P(-L / 2 + ramp, W / 2, h), P(L / 2 - ramp, W / 2, h), P(L / 2, W / 2, 0)], [[0, 0], [1, 0], [1, 1], [0, 1]], [sn, 0, -c]);
}

/**
 * addCommercialPavements(root, project, surf) -> { group, stats } | null. Adds one Group named 'commercial-pavements' to `root`.
 * Only for a commercial project with pavement areas. surf(xMm, yMm) gives the ground height in metres. Safe without a DOM
 * (textures are skipped and flat colours used), which is how the tests build it.
 */
export function addCommercialPavements(root, project, surf, { model = null } = {}) {
  if (project?.mode !== 'commercial' || !project.commercial) return null;
  const m = model || pavementModel(project.commercial, project.site?.lot || null);
  if (!m.areas.length && !m.kerbs.length) return null;
  const H = (xm, zm) => surf(xm * 1000, zm * 1000);
  const group = new THREE.Group();
  group.name = 'commercial-pavements';
  const stats = { areas: 0, kerbs: 0, paint: 0, stops: 0, humps: 0, symbols: 0 };
  const flag = (mesh, name) => { if (!mesh) return; mesh.userData = { ...mesh.userData, ground: true, extras: true, pavements: true }; mesh.name = name; mesh.renderOrder = 2; group.add(mesh); };

  // Pavement areas, one slot per pavement type so each gets its own texture
  {
    const b = new GeoBuilder();
    const mats = {};
    for (const a of m.areas) {
      const t = pavementById(a.type);
      if (!t) continue;
      addArea(b, a.type, a.polygon, H, t.texture3d.tileM);
      stats.areas += 1;
      if (!mats[a.type]) {
        const tex = textureFor(t.texture3d);
        mats[a.type] = tex ? mat('#ffffff', { map: tex, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }) : mat(t.colour, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
      }
    }
    flag(makeMesh(b.build(), mats, { ground: true }, { cast: false, receive: true }), 'pavement-areas');
  }

  // Kerbs
  {
    const b = new GeoBuilder();
    const mats = {};
    const kt = kerbTex();
    for (const k of m.kerbs) {
      const kd = kerbById(k.type);
      if (!kd) continue;
      addKerb(b, k.type, kd, k.polyline, H);
      stats.kerbs += 1;
      if (!mats[k.type]) mats[k.type] = kt ? mat('#ffffff', { map: kt, color: kd.colour, roughness: 0.88 }) : mat(kd.colour, { roughness: 0.88 });
    }
    flag(makeMesh(b.build(), mats, { ground: true }, { cast: true, receive: true }), 'pavement-kerbs');
  }

  // Paint
  {
    const b = new GeoBuilder();
    const mats = {
      white: mat(PAINT.white, { roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
      yellow: mat(PAINT.yellow, { roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
      blue: mat(PAINT.blue, { roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
      stop: mat('#d6d3c8', { roughness: 0.9 }),
      hump: mat('#c4b36b', { roughness: 0.9 }),
      icon: null,
    };
    const iconTex = accessibleTex();
    mats.icon = iconTex ? mat('#ffffff', { map: iconTex, roughness: 0.8, transparent: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }) : mat(PAINT.blue, { polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const colourSlot = (c) => (c === PAINT.yellow ? 'yellow' : c === PAINT.blue ? 'blue' : 'white');
    for (const it of m.items) {
      if (!markingById(it.type)) continue;
      const g = markingGeometry(it);
      if (g.solid?.type === 'box') {
        const s = g.solid;
        addOrientedBox(b, s.centre.x / 1000, s.centre.y / 1000, s.uMm / 2000, s.vMm / 2000, (s.rotationDeg * Math.PI) / 180, H(s.centre.x / 1000, s.centre.y / 1000) + GROUND, H(s.centre.x / 1000, s.centre.y / 1000) + GROUND + s.heightMm / 1000, 'stop');
        stats.stops += 1;
        continue;
      }
      if (g.solid?.type === 'hump') {
        addHump(b, 'hump', g.solid, H);
        stats.humps += 1;
      }
      for (const p of g.polygons) {
        if (p.kind === 'solid') continue;
        if (g.solid?.type === 'hump') continue; // the hump itself is the yellow solid
        if (g.symbol && p.colour === PAINT.blue) {
          // the blue square carries the wheelchair symbol as a texture
          const q = p.polygon.map((pt) => { const x = pt.x / 1000; const z = pt.y / 1000; return [x, H(x, z) + GROUND + PAINT_LIFT, z]; });
          b.quad('icon', q[0], q[1], q[2], q[3], [[0, 0], [1, 0], [1, 1], [0, 1]], [0, 1, 0]);
          stats.symbols += 1;
          continue;
        }
        addPaint(b, colourSlot(p.colour), p.polygon, H, PAINT_LIFT);
        stats.paint += 1;
      }
    }
    flag(makeMesh(b.build(), mats, { ground: true }, { cast: false, receive: true }), 'pavement-markings');
  }
  if (!group.children.length) return null;
  root.add(group);
  return { group, stats };
}
