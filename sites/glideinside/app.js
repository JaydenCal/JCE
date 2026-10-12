// Glide Inside demo: builds a furnished 3D apartment from PLAN and flies a camera through it.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { PLAN } from './plan.js';
import { planSVG, PLAN_VIEWBOX } from './planart.js';

export const DURATION = 60;
const H = PLAN.wallHeight;

// ---------- small helpers ----------
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function rng(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }

function canvasTexture(size, draw, metres) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  t.repeat.set(1 / metres, 1 / metres);
  return t;
}

function timberTexture() {
  return canvasTexture(1024, (g, S) => {
    const R = rng(7); const plankW = S / 12; // 12 planks across 2.4 m = 0.2 m boards
    for (let i = 0; i < 12; i++) {
      let y = -R() * S;
      while (y < S) {
        const len = S * (0.38 + R() * 0.32);
        const l = 58 + R() * 9, h = 30 + R() * 6, sat = 38 + R() * 10;
        g.fillStyle = `hsl(${h} ${sat}% ${l}%)`;
        g.fillRect(i * plankW, y, plankW, len);
        g.globalAlpha = 0.10;
        for (let k = 0; k < 9; k++) {
          g.strokeStyle = R() > 0.5 ? '#5b3b22' : '#f3dcc0';
          g.lineWidth = 0.6 + R() * 1.2;
          const x = i * plankW + R() * plankW;
          g.beginPath(); g.moveTo(x, y); g.bezierCurveTo(x + (R() - 0.5) * 8, y + len * 0.3, x + (R() - 0.5) * 8, y + len * 0.7, x + (R() - 0.5) * 6, y + len); g.stroke();
        }
        g.globalAlpha = 1;
        g.fillStyle = 'rgba(70,45,25,0.55)'; g.fillRect(i * plankW, y, plankW, 1.5);
        y += len;
      }
      g.fillStyle = 'rgba(70,45,25,0.45)'; g.fillRect(i * plankW, 0, 1.5, S);
    }
  }, 2.4);
}
function carpetTexture() {
  return canvasTexture(512, (g, S) => {
    g.fillStyle = '#cbc3b6'; g.fillRect(0, 0, S, S);
    const R = rng(11);
    for (let i = 0; i < 26000; i++) { const v = R(); g.fillStyle = v > 0.5 ? 'rgba(255,255,255,0.10)' : 'rgba(80,70,60,0.10)'; g.fillRect(R() * S, R() * S, 1.6, 1.6); }
  }, 1.0);
}
function tileTexture(base, grout, n, metres) {
  return canvasTexture(512, (g, S) => {
    const R = rng(23);
    const step = S / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      g.fillStyle = base; g.fillRect(i * step, j * step, step, step);
      g.fillStyle = `rgba(0,0,0,${0.015 + R() * 0.03})`; g.fillRect(i * step, j * step, step, step);
    }
    g.fillStyle = grout;
    for (let i = 0; i <= n; i++) { g.fillRect(i * step - 1.5, 0, 3, S); g.fillRect(0, i * step - 1.5, S, 3); }
  }, metres);
}
function skyTexture() {
  const c = document.createElement('canvas'); c.width = 16; c.height = 512;
  const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 0, 512);
  gr.addColorStop(0, '#9ebfdd'); gr.addColorStop(0.55, '#d6e4ee'); gr.addColorStop(1, '#eef1ee');
  g.fillStyle = gr; g.fillRect(0, 0, 16, 512);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function facadeTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d');
  for (let f = 0; f < 2; f++) {
    const y = f * 256;
    g.fillStyle = '#e3dfd7'; g.fillRect(0, y, 512, 256);
    g.fillStyle = '#7d8c95'; g.fillRect(0, y + 70, 512, 186);
    g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(0, y + 70, 512, 40);
    g.fillStyle = '#d9dbd8'; for (let x = 0; x <= 512; x += 128) g.fillRect(x - 3, y + 70, 6, 186);
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(2.1, 4.0); return t;
}
function artTexture(seed) {
  const c = document.createElement('canvas'); c.width = 384; c.height = 256; const g = c.getContext('2d'); const R = rng(seed);
  const pal = ['#d9cbb5', '#a9b8a3', '#c98f6b', '#6f8a7e', '#e8e0d2', '#40514b', '#d2b48c'];
  g.fillStyle = '#efe9df'; g.fillRect(0, 0, 384, 256);
  for (let i = 0; i < 6; i++) {
    g.fillStyle = pal[Math.floor(R() * pal.length)]; g.globalAlpha = 0.85;
    const x = R() * 384, y = R() * 256, r = 40 + R() * 90;
    if (R() > 0.5) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
    else { g.beginPath(); g.moveTo(x - r, 256); g.lineTo(x - r, y); g.arc(x, y, r, Math.PI, 0); g.lineTo(x + r, 256); g.fill(); }
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// ---------- materials ----------
function makeMaterials() {
  const std = (color, roughness = 0.8, metalness = 0, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness, envMapIntensity: 0.55, ...extra });
  return {
    wall: std(0xf4f2ee, 0.92),
    ceiling: std(0xfbfaf7, 1, 0, { side: THREE.DoubleSide, transparent: true }),
    slab: std(0xd8d4cc, 0.95),
    facade: std(0xffffff, 0.9, 0, { map: facadeTexture() }),
    ground: std(0xc9d1c4, 1),
    timber: std(0xffffff, 0.62, 0, { map: timberTexture(), side: THREE.DoubleSide }),
    carpet: std(0xffffff, 1, 0, { map: carpetTexture(), side: THREE.DoubleSide }),
    tile: std(0xffffff, 0.35, 0, { map: tileTexture('#e7e4df', '#cdc7bf', 2, 1.2), side: THREE.DoubleSide }),
    deck: std(0xffffff, 0.8, 0, { map: tileTexture('#bdb7ad', '#a39d93', 2, 1.2), side: THREE.DoubleSide }),
    corridor: std(0x6d6a65, 1, 0, { side: THREE.DoubleSide }),
    frame: std(0x3a3a37, 0.5, 0.5),
    glass: std(0xcfe3ee, 0.04, 0, { transparent: true, opacity: 0.16, depthWrite: false, envMapIntensity: 1.2 }),
    glassObscure: std(0xf4f6f6, 0.3, 0, { transparent: true, opacity: 0.7 }),
    glassShower: std(0xdfeef2, 0.05, 0, { transparent: true, opacity: 0.12, depthWrite: false }),
    door: std(0xf3f2ee, 0.55),
    doorEntry: std(0x7a5a3e, 0.5),
    joinery: std(0xecebe6, 0.55),
    cabinet: std(0x343a3e, 0.55),
    cabinetIsland: std(0xb68c62, 0.6),
    stone: std(0xf3f2ef, 0.25),
    steel: std(0xc6c9cb, 0.32, 0.75),
    dark: std(0x2b2c2d, 0.6),
    black: std(0x111214, 0.3),
    timberDark: std(0x8a6748, 0.6),
    timberLight: std(0xc39b72, 0.6),
    linen: std(0xf5f3ef, 0.95),
    duvet: std(0xe9e4dc, 0.95),
    throwA: std(0xb79b78, 0.95),
    throwB: std(0x6f8a7e, 0.95),
    pillow: std(0xfbfaf8, 0.95),
    headboard: std(0xcdc4b6, 0.95),
    sofa: std(0x8b8781, 0.95),
    sofaCushion: std(0x95918b, 0.95),
    accent: std(0x5f7f72, 0.95),
    rug: std(0xdad4c8, 1),
    ceramic: std(0xf8f8f6, 0.2),
    water: std(0xdbe5ea, 0.15),
    mirror: std(0xd5dde0, 0.05, 0.9),
    chair: std(0x2f2f2d, 0.6),
    pot: std(0xb8b0a5, 0.85),
    leaf: std(0x5b7a4a, 0.85),
    leafDark: std(0x46633b, 0.85),
    lampShade: std(0xf5efe3, 0.9, 0, { emissive: 0xffe3bd, emissiveIntensity: 0.35 }),
    bulb: std(0xfff4dd, 0.4, 0, { emissive: 0xffd9a0, emissiveIntensity: 1.4 }),
    tv: std(0x0d0e10, 0.18, 0.2),
    outdoorFrame: std(0x3b3c3c, 0.55, 0.4),
    outdoorFabric: std(0xd9d2c5, 0.95),
    planter: std(0x9c968c, 0.9),
    planOverlay: new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false }),
  };
}

// ---------- geometry helpers ----------
function box(group, x0, z0, x1, z1, y0, y1, mat, cast = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)), mat);
  m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  m.castShadow = cast; m.receiveShadow = true; group.add(m); return m;
}
function cyl(group, x, z, r, y0, y1, mat, seg = 24, sx = 1, sz = 1) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, y1 - y0, seg), mat);
  m.position.set(x, (y0 + y1) / 2, z); m.scale.set(sx, 1, sz); m.castShadow = true; m.receiveShadow = true; group.add(m); return m;
}
const OPP = { n: 's', s: 'n', e: 'w', w: 'e' };
// Local frame: origin on the 'start' side of rect, +X running across to the other side, Z across the width.
function frame(parent, rect, start) {
  const [x0, y0, x1, y1] = rect; const g = new THREE.Group();
  let ox, oz, ux, uy, len, wid;
  if (start === 'n') { ox = (x0 + x1) / 2; oz = y0; ux = 0; uy = 1; len = y1 - y0; wid = x1 - x0; }
  if (start === 's') { ox = (x0 + x1) / 2; oz = y1; ux = 0; uy = -1; len = y1 - y0; wid = x1 - x0; }
  if (start === 'w') { ox = x0; oz = (y0 + y1) / 2; ux = 1; uy = 0; len = x1 - x0; wid = y1 - y0; }
  if (start === 'e') { ox = x1; oz = (y0 + y1) / 2; ux = -1; uy = 0; len = x1 - x0; wid = y1 - y0; }
  g.position.set(ox, 0, oz); g.rotation.y = Math.atan2(-uy, ux); parent.add(g);
  return { g, len, wid };
}
function lbox(g, x0, x1, y0, y1, z0, z1, mat, cast = true) { return box(g, x0, z0, x1, z1, y0, y1, mat, cast); }
function shapeFromPoly(poly) {
  const s = new THREE.Shape();
  poly.forEach(([x, y], i) => (i ? s.lineTo(x, -y) : s.moveTo(x, -y)));
  s.closePath(); return s;
}

// ---------- builders ----------
function buildFloors(group, M) {
  for (const r of PLAN.rooms) {
    const geo = new THREE.ShapeGeometry(shapeFromPoly(r.poly)); geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, M[r.floor]); m.position.y = r.outdoor ? -0.03 : 0.0; m.receiveShadow = true; group.add(m);
  }
}
function buildCeilings(group, M) {
  for (const r of PLAN.rooms) {
    if (r.outdoor) continue;
    const geo = new THREE.ShapeGeometry(shapeFromPoly(r.poly)); geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, M.ceiling); m.position.y = H; group.add(m);
    // downlights
    const xs = r.poly.map(p => p[0]), ys = r.poly.map(p => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const d = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.01, 16), M.bulb); d.position.set(cx, H - 0.006, cy); group.add(d);
  }
}

function wallFrame(w) {
  const [ax, ay] = w.a, [bx, by] = w.b; const L = Math.hypot(bx - ax, by - ay);
  const ux = (bx - ax) / L, uy = (by - ay) / L;
  return { ax, ay, L, ux, uy, nx: -uy, ny: ux, t: w.t, e: w.ext ? w.t / 2 : 0, rotY: Math.atan2(-uy, ux) };
}
function wallGroup(parent, F, s) {
  const g = new THREE.Group(); g.position.set(F.ax + F.ux * s, 0, F.ay + F.uy * s); g.rotation.y = F.rotY; parent.add(g); return g;
}
function windowUnit(parent, F, o, M, glassMat) {
  const len = o.to - o.from, h0 = o.sill, h1 = o.head, fw = 0.05, d = 0.07;
  const g = wallGroup(parent, F, (o.from + o.to) / 2);
  const bar = (x0, x1, y0, y1) => { const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, d), M.frame); m.position.set((x0 + x1) / 2, (y0 + y1) / 2, 0); m.castShadow = true; g.add(m); };
  bar(-len / 2, len / 2, h0, h0 + fw); bar(-len / 2, len / 2, h1 - fw, h1); bar(-len / 2, -len / 2 + fw, h0, h1); bar(len / 2 - fw, len / 2, h0, h1);
  if (len > 1.8) bar(-fw / 2, fw / 2, h0, h1);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(len - 2 * fw, h1 - h0 - 2 * fw, 0.012), glassMat || M.glass);
  glass.position.set(0, (h0 + h1) / 2, 0); g.add(glass);
}
function sliderUnit(parent, F, o, M) {
  const panel = (s0, s1, off) => {
    const len = s1 - s0, g = wallGroup(parent, F, (s0 + s1) / 2), fw = 0.05, d = 0.05, h1 = o.head;
    const bar = (x0, x1, y0, y1) => { const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, d), M.frame); m.position.set((x0 + x1) / 2, (y0 + y1) / 2, off); m.castShadow = true; g.add(m); };
    bar(-len / 2, len / 2, 0, 0.06); bar(-len / 2, len / 2, h1 - fw, h1); bar(-len / 2, -len / 2 + fw, 0, h1); bar(len / 2 - fw, len / 2, 0, h1);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(len - 2 * fw, h1 - 0.06 - fw, 0.012), M.glass);
    glass.position.set(0, (0.06 + h1 - fw) / 2, off); g.add(glass);
  };
  const half = (o.to - o.openTo) / 2;
  panel(o.openTo, o.openTo + half, 0.045); panel(o.openTo + half, o.to, 0.045);
  panel(o.openTo + 0.04, o.openTo + half + 0.04, -0.045); panel(o.openTo + half - 0.04, o.to - 0.04, -0.045);
}
function doorUnit(parent, F, o, M) {
  const w = o.to - o.from; const hs = o.hinge === 'from' ? o.from : o.to;
  const off = o.side * F.t / 2;
  const hx = F.ax + F.ux * hs + F.nx * off, hz = F.ay + F.uy * hs + F.ny * off;
  const th = (o.open || 90) * Math.PI / 180, cs = o.hinge === 'from' ? 1 : -1;
  const dx = F.ux * cs * Math.cos(th) + F.nx * o.side * Math.sin(th), dz = F.uy * cs * Math.cos(th) + F.ny * o.side * Math.sin(th);
  const g = new THREE.Group(); g.position.set(hx, 0, hz); g.rotation.y = Math.atan2(-dz, dx); parent.add(g);
  const leaf = new THREE.Mesh(new THREE.BoxGeometry(w - 0.03, PLAN.doorHeight - 0.02, 0.04), o.id === 'entry' ? M.doorEntry : M.door);
  leaf.position.set(w / 2, (PLAN.doorHeight - 0.02) / 2, 0.02 * o.side); leaf.castShadow = true; leaf.receiveShadow = true; g.add(leaf);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.02, 0.1), M.steel); handle.position.set(w - 0.12, 1.02, 0.02 * o.side); g.add(handle);
}
function buildWalls(group, M) {
  for (const w of PLAN.walls) {
    const F = wallFrame(w);
    const ops = [...(w.openings || [])].sort((p, q) => p.from - q.from);
    let s = 0; const spans = [];
    for (const o of ops) { if (o.from > s) spans.push([s, o.from]); s = o.to; }
    if (s < F.L) spans.push([s, F.L]);
    const piece = (s0, s1, y0, y1) => {
      if (s1 - s0 < 1e-3 || y1 - y0 < 1e-3) return;
      const m = new THREE.Mesh(new THREE.BoxGeometry(s1 - s0, y1 - y0, F.t), M.wall);
      m.position.set(F.ax + F.ux * (s0 + s1) / 2, (y0 + y1) / 2, F.ay + F.uy * (s0 + s1) / 2);
      m.rotation.y = F.rotY; m.castShadow = true; m.receiveShadow = true; group.add(m);
    };
    for (const [s0, s1] of spans) piece(s0 <= 1e-6 ? s0 - F.e : s0, s1 >= F.L - 1e-6 ? s1 + F.e : s1, 0, H);
    for (const o of ops) {
      const head = o.head ?? PLAN.doorHeight, sill = o.sill ?? 0;
      piece(o.from, o.to, head, H);
      if (sill > 0) piece(o.from, o.to, 0, sill);
      if (o.type === 'window') windowUnit(group, F, o, M, o.obscure ? M.glassObscure : M.glass);
      if (o.type === 'slider') sliderUnit(group, F, o, M);
      if (o.type === 'door') doorUnit(group, F, o, M);
    }
  }
}

function plant(g, x, z, s, M) {
  cyl(g, x, z, 0.17 * s, 0, 0.38 * s, M.pot);
  const R = rng(Math.round(x * 100 + z * 10));
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry((0.2 + R() * 0.12) * s, 2), i % 2 ? M.leaf : M.leafDark);
    m.position.set(x + (R() - 0.5) * 0.25 * s, (0.62 + i * 0.16 + R() * 0.1) * s, z + (R() - 0.5) * 0.25 * s);
    m.castShadow = true; g.add(m);
  }
}

function buildFurniture(group, M) {
  for (const it of PLAN.furniture) {
    const r = it.rect;
    switch (it.type) {
      case 'bed': {
        const { g, len: L, wid: W } = frame(group, r, it.head);
        lbox(g, 0.06, L, 0.06, 0.32, -W / 2, W / 2, M.headboard);
        lbox(g, 0.09, L - 0.02, 0.32, 0.52, -W / 2 + 0.02, W / 2 - 0.02, M.linen);
        lbox(g, 0.62, L + 0.012, 0.5, 0.585, -W / 2 - 0.012, W / 2 + 0.012, M.duvet);
        lbox(g, L - 0.55, L + 0.02, 0.585, 0.61, -W / 2 - 0.02, W / 2 + 0.02, it.size === 'queen' ? M.throwB : M.throwA);
        const pw = (W - 0.24) / 2;
        lbox(g, 0.12, 0.48, 0.52, 0.66, -W / 2 + 0.08, -W / 2 + 0.08 + pw, M.pillow);
        lbox(g, 0.12, 0.48, 0.52, 0.66, W / 2 - 0.08 - pw, W / 2 - 0.08, M.pillow);
        lbox(g, 0, 0.07, 0, 1.15, -W / 2 - 0.04, W / 2 + 0.04, M.headboard);
        break;
      }
      case 'bedside': {
        const [x0, y0, x1, y1] = r;
        box(group, x0, y0, x1, y1, 0.0, 0.5, M.timberLight);
        const cx = (x0 + x1) / 2, cz = (y0 + y1) / 2;
        cyl(group, cx, cz, 0.06, 0.5, 0.78, M.ceramic, 16);
        cyl(group, cx, cz, 0.13, 0.78, 0.95, M.lampShade, 24);
        break;
      }
      case 'robe': {
        const { g, len: L, wid: W } = frame(group, r, OPP[it.front]);
        lbox(g, 0, L, 0, 2.4, -W / 2, W / 2, M.joinery);
        const n = Math.max(2, Math.round(W / 0.6));
        for (let i = 1; i < n; i++) { const z = -W / 2 + (W * i) / n; lbox(g, L - 0.002, L + 0.004, 0.05, 2.35, z - 0.004, z + 0.004, M.dark, false); }
        for (let i = 0; i < n; i++) { const z = -W / 2 + (W * (i + 0.5)) / n + (i % 2 ? -0.22 : 0.22) * (W / n) / 0.6 * 0.5; lbox(g, L, L + 0.025, 0.9, 1.3, z - 0.008, z + 0.008, M.steel, false); }
        break;
      }
      case 'bath': {
        const [x0, y0, x1, y1] = r;
        box(group, x0, y0, x1, y1, 0, 0.55, M.ceramic);
        box(group, x0 + 0.08, y0 + 0.08, x1 - 0.08, y1 - 0.08, 0.545, 0.553, M.water, false);
        cyl(group, x1 - 0.2, (y0 + y1) / 2, 0.02, 0.55, 0.75, M.steel, 12);
        break;
      }
      case 'vanity': {
        const { g, len: L, wid: W } = frame(group, r, OPP[it.front]);
        lbox(g, 0, L, 0.22, 0.8, -W / 2, W / 2, M.timberLight);
        lbox(g, 0, L + 0.01, 0.8, 0.84, -W / 2, W / 2, M.stone);
        const b = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.15, 0.12, 28), M.ceramic); b.position.set(L * 0.55, 0.9, 0); b.scale.set(0.9, 1, 1.25); b.castShadow = true; g.add(b);
        lbox(g, 0.06, 0.1, 0.84, 1.0, -0.015, 0.015, M.steel);
        lbox(g, 0, 0.02, 1.0, 1.8, -W / 2 + 0.06, W / 2 - 0.06, M.mirror, false);
        break;
      }
      case 'toilet': {
        const { g, len: L } = frame(group, r, OPP[it.front]);
        lbox(g, 0, 0.18, 0.38, 0.8, -0.19, 0.19, M.ceramic);
        const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.16, 0.4, 24), M.ceramic); bowl.position.set(0.42, 0.2, 0); bowl.scale.set(1.25, 1, 0.9); bowl.castShadow = true; g.add(bowl);
        lbox(g, 0.18, L - 0.02, 0.4, 0.43, -0.18, 0.18, M.ceramic);
        break;
      }
      case 'shower': {
        const [x0, y0, x1, y1] = r;
        box(group, x0, y0, x1, y1, 0, 0.03, M.ceramic, false);
        for (const side of it.open) {
          if (side === 'w') box(group, x0 - 0.005, y0, x0 + 0.005, y1, 0.03, 1.98, M.glassShower, false);
          if (side === 'e') box(group, x1 - 0.005, y0, x1 + 0.005, y1, 0.03, 1.98, M.glassShower, false);
          if (side === 's') box(group, x0, y1 - 0.005, x1, y1 + 0.005, 0.03, 1.98, M.glassShower, false);
          if (side === 'n') box(group, x0, y0 - 0.005, x1, y0 + 0.005, 0.03, 1.98, M.glassShower, false);
        }
        const cx = (x0 + x1) / 2;
        cyl(group, cx, y0 + 0.08, 0.1, 2.02, 2.04, M.steel, 20);
        break;
      }
      case 'bench': {
        const { g, len: L, wid: W } = frame(group, r, OPP[it.front]);
        lbox(g, 0.05, L - 0.04, 0, 0.12, -W / 2, W / 2, M.black);
        lbox(g, 0, L - 0.02, 0.12, 0.87, -W / 2, W / 2, M.cabinet);
        lbox(g, 0, L + 0.02, 0.87, 0.91, -W / 2, W / 2, M.stone);
        lbox(g, 0, 0.02, 0.91, 1.48, -W / 2, W / 2, M.stone);
        const [sx, sy] = it.sink, [cx, cy] = it.cooktop;
        box(group, sx - 0.36, sy - 0.2, sx + 0.36, sy + 0.2, 0.905, 0.914, M.steel, false);
        box(group, sx - 0.03, 0.2, sx + 0.03, 0.26, 0.91, 1.22, M.steel);
        box(group, cx - 0.3, cy - 0.25, cx + 0.3, cy + 0.25, 0.905, 0.915, M.black, false);
        break;
      }
      case 'overhead': {
        const [x0, y0, x1, y1] = r;
        box(group, x0, y0, x1, y1, 1.5, 2.3, M.joinery);
        box(group, x0 + 0.02, y1 - 0.06, x1 - 0.02, y1 - 0.04, 1.497, 1.5, M.bulb, false);
        break;
      }
      case 'fridge': {
        const [x0, y0, x1, y1] = r;
        box(group, x0, y0, x1, y1, 0, 1.86, M.steel);
        box(group, x0, y0, x1, y1, 1.88, 2.4, M.joinery);
        box(group, x0 + 0.06, y1, x0 + 0.08, y1 + 0.03, 0.8, 1.5, M.dark);
        break;
      }
      case 'island': {
        const [x0, y0, x1, y1] = r;
        box(group, x0 + 0.04, y0 + 0.04, x1 - 0.04, y1 - 0.3, 0, 0.88, M.cabinetIsland);
        box(group, x0, y0, x1, y1, 0.88, 0.92, M.stone);
        box(group, x0, y0, x0 + 0.04, y1, 0, 0.88, M.stone);
        box(group, x1 - 0.04, y0, x1, y1, 0, 0.88, M.stone);
        break;
      }
      case 'stool': {
        const [x, z] = it.at;
        cyl(group, x, z, 0.19, 0.62, 0.67, M.timberLight, 24);
        cyl(group, x, z, 0.022, 0.02, 0.62, M.dark, 10);
        cyl(group, x, z, 0.2, 0, 0.02, M.dark, 24);
        cyl(group, x, z, 0.16, 0.25, 0.27, M.dark, 24);
        break;
      }
      case 'pendant': {
        const [x, z] = it.at; const y = H - it.drop;
        cyl(group, x, z, 0.005, y + 0.18, H, M.dark, 6);
        if (it.wide) {
          const dome = new THREE.Mesh(new THREE.SphereGeometry(0.32, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), M.dark); dome.position.set(x, y, z); dome.castShadow = true; group.add(dome);
          cyl(group, x, z, 0.28, y - 0.005, y + 0.005, M.bulb, 24);
        } else {
          cyl(group, x, z, 0.11, y, y + 0.2, M.dark, 20);
          cyl(group, x, z, 0.1, y - 0.003, y + 0.004, M.bulb, 20);
        }
        break;
      }
      case 'rug': { const [x0, y0, x1, y1] = r; box(group, x0, y0, x1, y1, 0.002, 0.014, M.rug, false); break; }
      case 'sofa': case 'armchair': {
        const { g, len: L, wid: W } = frame(group, r, OPP[it.front]);
        const body = it.outdoor ? M.outdoorFabric : M.sofa, cush = it.outdoor ? M.outdoorFabric : M.sofaCushion;
        lbox(g, 0, L, 0.08, 0.42, -W / 2, W / 2, body);
        lbox(g, 0, 0.22, 0.42, it.type === 'sofa' ? 0.86 : 0.8, -W / 2, W / 2, body);
        lbox(g, 0, L, 0.08, 0.62, -W / 2, -W / 2 + 0.17, body);
        lbox(g, 0, L, 0.08, 0.62, W / 2 - 0.17, W / 2, body);
        const n = it.type === 'sofa' ? 3 : 1; const inner = W - 0.34;
        for (let i = 0; i < n; i++) {
          const z0 = -inner / 2 + (inner * i) / n + 0.01, z1 = -inner / 2 + (inner * (i + 1)) / n - 0.01;
          lbox(g, 0.22, L - 0.02, 0.42, 0.52, z0, z1, cush);
          lbox(g, 0.2, 0.38, 0.5, 0.82, z0, z1, cush);
        }
        if (it.type === 'sofa') { lbox(g, 0.36, 0.5, 0.52, 0.8, -inner / 2 + 0.05, -inner / 2 + 0.45, M.accent); lbox(g, 0.36, 0.5, 0.52, 0.78, inner / 2 - 0.45, inner / 2 - 0.05, M.throwA); }
        for (const [lx, lz] of [[0.05, -W / 2 + 0.05], [0.05, W / 2 - 0.05], [L - 0.05, -W / 2 + 0.05], [L - 0.05, W / 2 - 0.05]]) lbox(g, lx - 0.025, lx + 0.025, 0, 0.08, lz - 0.025, lz + 0.025, it.outdoor ? M.outdoorFrame : M.dark);
        break;
      }
      case 'coffee': {
        const [x0, y0, x1, y1] = r;
        box(group, x0, y0, x1, y1, 0.36, 0.4, M.timberDark);
        box(group, x0 + 0.08, y0 + 0.08, x1 - 0.08, y1 - 0.08, 0, 0.36, M.timberDark);
        cyl(group, (x0 + x1) / 2 - 0.1, (y0 + y1) / 2, 0.08, 0.4, 0.5, M.ceramic, 18);
        break;
      }
      case 'tvunit': {
        const { g, len: L } = frame(group, r, OPP[it.front]);
        const W = r[3] - r[1];
        lbox(g, 0, L, 0.14, 0.5, -W / 2, W / 2, M.timberLight);
        lbox(g, 0.0, 0.04, 0.98, 1.8, -0.74, 0.74, M.tv);
        break;
      }
      case 'lamp': {
        const [x, z] = it.at;
        cyl(group, x, z, 0.15, 0, 0.02, M.dark, 20);
        cyl(group, x, z, 0.012, 0.02, 1.48, M.dark, 8);
        cyl(group, x, z, 0.19, 1.42, 1.72, M.lampShade, 24);
        break;
      }
      case 'table': {
        const [x0, y0, x1, y1] = r;
        box(group, x0, y0, x1, y1, 0.71, 0.75, M.timberLight);
        for (const [x, z] of [[x0 + 0.1, y0 + 0.1], [x1 - 0.1, y0 + 0.1], [x0 + 0.1, y1 - 0.1], [x1 - 0.1, y1 - 0.1]]) box(group, x - 0.03, z - 0.03, x + 0.03, z + 0.03, 0, 0.71, M.timberDark);
        break;
      }
      case 'chair': case 'outchair': {
        const [cx, cz] = it.at; const rr = [cx - 0.22, cz - 0.22, cx + 0.22, cz + 0.22];
        const { g } = frame(group, rr, OPP[it.front]);
        const mat = it.type === 'outchair' ? M.outdoorFrame : M.chair;
        lbox(g, 0.03, 0.44, 0.43, 0.47, -0.2, 0.2, it.type === 'outchair' ? M.outdoorFabric : M.timberLight);
        lbox(g, 0.0, 0.04, 0.47, 0.86, -0.2, 0.2, mat);
        for (const [lx, lz] of [[0.04, -0.18], [0.04, 0.18], [0.41, -0.18], [0.41, 0.18]]) lbox(g, lx - 0.015, lx + 0.015, 0, 0.43, lz - 0.015, lz + 0.015, mat);
        break;
      }
      case 'plant': plant(group, it.at[0], it.at[1], it.scale || 1, M); break;
      case 'outtable': {
        const [x, z] = it.at;
        cyl(group, x, z, 0.4, 0.7, 0.73, M.outdoorFrame, 32);
        cyl(group, x, z, 0.03, 0, 0.7, M.outdoorFrame, 10);
        cyl(group, x, z, 0.25, 0, 0.02, M.outdoorFrame, 24);
        break;
      }
      case 'planter': {
        const [x0, y0, x1, y1] = r;
        box(group, x0, y0, x1, y1, -0.03, 0.5, M.planter);
        const R = rng(Math.round(x0 * 100));
        for (let x = x0 + 0.18; x < x1 - 0.1; x += 0.24) {
          const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.15 + R() * 0.06, 1), R() > 0.5 ? M.leaf : M.leafDark);
          m.position.set(x, 0.62 + R() * 0.08, (y0 + y1) / 2); m.castShadow = true; group.add(m);
        }
        break;
      }
      default: break;
    }
  }
}

function buildDecor(group, M) {
  const art = (cx, cz, w, h, y0, axis, seed, faceSign) => {
    const mat = new THREE.MeshStandardMaterial({ map: artTexture(seed), roughness: 0.9, envMapIntensity: 0.4 });
    const frameM = M.timberDark;
    if (axis === 'x') { // hangs on a wall running along x (faces +/- z)
      box(group, cx - w / 2 - 0.025, cz - 0.015, cx + w / 2 + 0.025, cz + 0.015, y0 - 0.025, y0 + h + 0.025, frameM, false);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); m.position.set(cx, y0 + h / 2, cz + 0.017 * faceSign); if (faceSign < 0) m.rotation.y = Math.PI; group.add(m);
    } else { // wall runs along z (faces +/- x)
      box(group, cx - 0.015, cz - w / 2 - 0.025, cx + 0.015, cz + w / 2 + 0.025, y0 - 0.025, y0 + h + 0.025, frameM, false);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); m.position.set(cx + 0.017 * faceSign, y0 + h / 2, cz); m.rotation.y = faceSign > 0 ? Math.PI / 2 : -Math.PI / 2; group.add(m);
    }
  };
  art(4.475, 6.5, 1.1, 0.75, 1.2, 'z', 5, 1);     // dining wall
  art(4.325, 6.5, 0.95, 0.55, 1.3, 'z', 8, -1);   // above the main bed
  art(1.6, 0.075, 0.85, 0.6, 1.3, 'x', 13, 1);    // above bed 2
  // island vase and dining bowl
  cyl(group, 9.9, 2.3, 0.07, 0.92, 1.18, M.ceramic, 18);
  for (let i = 0; i < 3; i++) { const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.09, 1), M.leaf); m.position.set(9.9 + (i - 1) * 0.06, 1.24 + i * 0.03, 2.3 + (i % 2) * 0.04); group.add(m); }
  cyl(group, 6.2, 5.12, 0.16, 0.75, 0.82, M.timberDark, 24);
}

function buildContext(group, corridor, M) {
  // floor slabs and the building below
  box(group, -0.13, -0.13, 12.13, 8.13, -0.3, -0.004, M.slab);
  box(group, 6.6, 8.0, 11.6, 10.4, -0.3, -0.035, M.slab);
  box(group, -0.3, -2.9, 12.3, 8.3, -24, -0.3, M.facade);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), M.ground); ground.rotation.x = -Math.PI / 2; ground.position.y = -24; group.add(ground);
  // surrounding suburb: low buildings and trees, faded by fog
  const R = rng(99), dummy = new THREE.Object3D(), col = new THREE.Color();
  const bMat = new THREE.MeshStandardMaterial({ roughness: 0.9, envMapIntensity: 0.4 });
  const bld = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), bMat, 170);
  const pal = [0xe4e0d8, 0xd9d4ca, 0xebe7df, 0xd2cfc8, 0xc9d0d3, 0xe0d9cb, 0xcbc6bc];
  for (let i = 0; i < 170; i++) {
    const a = R() * Math.PI * 2, r = 75 + R() * 170, w = 12 + R() * 22, d = 12 + R() * 22, h = 6 + Math.pow(R(), 2) * 30 + (r > 150 ? R() * 22 : 0);
    dummy.position.set(6 + Math.cos(a) * r, -24 + h / 2, 5 + Math.sin(a) * r); dummy.scale.set(w, h, d); dummy.rotation.y = (R() - 0.5) * 0.5; dummy.updateMatrix();
    bld.setMatrixAt(i, dummy.matrix); bld.setColorAt(i, col.setHex(pal[Math.floor(R() * pal.length)]));
  }
  group.add(bld);
  const tMat = new THREE.MeshStandardMaterial({ roughness: 0.9, envMapIntensity: 0.4 });
  const trees = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 2), tMat, 360);
  const greens = [0x62804f, 0x557344, 0x6f8a5c, 0x4c673d];
  for (let i = 0; i < 360; i++) {
    const park = i < 140;
    const a = park ? Math.PI / 2 + (R() - 0.5) * 1.6 : R() * Math.PI * 2, r = park ? 30 + R() * 70 : 34 + R() * 140, s = 1.6 + R() * 1.8;
    dummy.position.set(6 + Math.cos(a) * r, -24 + s * 0.85, 5 + Math.sin(a) * r); dummy.scale.set(s, s * 1.1, s); dummy.rotation.set(0, R() * 3, 0); dummy.updateMatrix();
    trees.setMatrixAt(i, dummy.matrix); trees.setColorAt(i, col.setHex(greens[Math.floor(R() * greens.length)]));
  }
  group.add(trees);
  // balcony balustrade
  const rail = (x0, z0, x1, z1) => { box(group, x0, z0, x1, z1, 0.0, 1.0, M.glass, false); box(group, x0 - 0.02, z0 - 0.02, x1 + 0.02, z1 + 0.02, 1.0, 1.04, M.frame); };
  rail(6.6, 10.39, 11.6, 10.41); rail(6.59, 8.0, 6.61, 10.4); rail(11.59, 8.0, 11.61, 10.4);
  // common corridor outside the entry
  box(corridor, 1.5, -2.6, 11.5, -0.13, -0.3, -0.004, M.slab, false);
  const cf = new THREE.Mesh(new THREE.PlaneGeometry(10, 2.47), M.corridor); cf.rotation.x = -Math.PI / 2; cf.position.set(6.5, 0.001, -1.365); cf.receiveShadow = true; corridor.add(cf);
  box(corridor, 1.5, -2.75, 11.5, -2.6, 0, H, M.wall);
  for (const x of [3.2, 10.3]) { box(corridor, x - 0.45, -2.6, x + 0.45, -2.56, 0, 2.08, M.doorEntry); }
}

// ---------- camera path ----------
// t (s), camera position, look-at target, field of view.
const KEYS = [
  { t: 0.0, p: [6.0, 17.5, 5.25], q: [6.0, 0.0, 5.15], f: 36 },
  { t: 4.8, p: [6.0, 12.6, 15.6], q: [6.0, 0.0, 5.0], f: 36 },
  { t: 9.0, p: [16.6, 10.4, 12.2], q: [6.2, 0.0, 4.6], f: 36 },
  { t: 12.8, p: [15.8, 8.6, -1.5], q: [6.4, 0.0, 3.6], f: 38 },
  { t: 16.0, p: [6.6, 2.3, -1.65], q: [6.5, 1.45, 2.0], f: 58 },
  { t: 18.6, p: [6.5, 1.6, -0.5], q: [6.45, 1.5, 3.0], f: 60 },
  { t: 21.0, p: [6.55, 1.6, 1.7], q: [6.8, 1.45, 5.5], f: 64 },
  { t: 24.5, p: [7.2, 1.6, 3.55], q: [10.4, 1.05, 1.1], f: 66 },
  { t: 28.0, p: [8.0, 1.6, 4.0], q: [11.6, 1.0, 6.0], f: 66 },
  { t: 31.0, p: [8.15, 1.62, 6.95], q: [5.4, 1.0, 4.9], f: 66 },
  { t: 33.6, p: [8.3, 1.6, 7.55], q: [8.5, 1.45, 11.5], f: 64 },
  { t: 36.0, p: [8.5, 1.6, 9.45], q: [8.9, -3.2, 15.0], f: 62 },
  { t: 38.2, p: [8.6, 1.6, 9.3], q: [7.6, 1.35, 4.5], f: 64 },
  { t: 40.4, p: [7.9, 1.6, 4.2], q: [5.0, 1.45, 3.6], f: 64 },
  { t: 42.4, p: [5.3, 1.6, 3.55], q: [4.4, 1.3, 1.2], f: 66 },
  { t: 44.2, p: [4.4, 1.6, 3.5], q: [4.3, 1.15, 0.6], f: 66 },
  { t: 46.2, p: [2.58, 1.6, 2.86], q: [1.3, 0.95, 0.85], f: 66 },
  { t: 47.5, p: [3.05, 1.6, 3.55], q: [7.5, 1.35, 4.4], f: 66 },
  { t: 48.7, p: [3.85, 1.6, 3.62], q: [3.75, 1.3, 7.4], f: 66 },
  { t: 50.6, p: [3.75, 1.6, 4.75], q: [1.0, 1.1, 7.2], f: 66 },
  { t: 52.4, p: [3.2, 1.6, 4.7], q: [0.7, 1.35, 4.2], f: 66 },
  { t: 54.2, p: [3.2, 4.4, 5.2], q: [2.2, 0.0, 6.0], f: 56 },
  { t: 57.0, p: [-4.8, 12.4, 16.4], q: [6.0, 0.0, 5.0], f: 36 },
  { t: 60.0, p: [-6.2, 13.4, 17.6], q: [6.0, 0.0, 5.0], f: 36 },
];
const TENSION = 0.85;
function tangent(j, key) {
  if (j <= 0 || j >= KEYS.length - 1) return [0, 0, 0];
  const a = KEYS[j - 1], b = KEYS[j + 1], dt = b.t - a.t;
  return b[key].map((v, i) => TENSION * (v - a[key][i]) / dt);
}
export function cameraAt(t) {
  t = clamp(t, 0, DURATION);
  let i = 0; while (i < KEYS.length - 2 && t > KEYS[i + 1].t) i++;
  const k0 = KEYS[i], k1 = KEYS[i + 1], h = k1.t - k0.t, s = (t - k0.t) / h;
  const s2 = s * s, s3 = s2 * s, h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
  const herm = key => { const m0 = tangent(i, key), m1 = tangent(i + 1, key); return k0[key].map((v, j) => h00 * v + h10 * h * m0[j] + h01 * k1[key][j] + h11 * h * m1[j]); };
  return { p: herm('p'), q: herm('q'), f: k0.f + (k1.f - k0.f) * (s2 * (3 - 2 * s)) };
}

const CAPTIONS = [
  [0.4, 2.7, 'Your floor plan'], [2.9, 5.7, 'Built in 3D'],
  [23.6, 27.2, 'Kitchen'], [27.4, 30.4, 'Living'], [30.6, 33.0, 'Dining'], [34.6, 38.0, 'Balcony'],
  [42.8, 45.0, 'Bathroom'], [45.4, 47.2, 'Bedroom 2'], [48.8, 51.9, 'Main bedroom'], [52.1, 53.8, 'Ensuite'],
];

const STYLE = `
.gi-stage{position:relative;overflow:hidden;background:#dfe7ec;container-type:inline-size}
.gi-stage canvas{display:block;width:100%;height:100%}
.gi-ov{position:absolute;inset:0;pointer-events:none;font-family:var(--gi-font,'Urbanist','Helvetica Neue',Arial,sans-serif)}
.gi-cap{position:absolute;left:4.2cqw;bottom:5.6cqw;display:flex;align-items:center;gap:1.1cqw;opacity:0;transition:none}
.gi-cap i{display:block;width:3.2cqw;height:0.32cqw;background:#ffffff;border-radius:1cqw}
.gi-cap span{color:#fff;font-weight:650;font-size:3.1cqw;letter-spacing:0.02em;text-shadow:0 0.15cqw 0.9cqw rgba(0,0,0,.45)}
.gi-tag{position:absolute;right:2.4cqw;top:2.2cqw;color:rgba(255,255,255,.92);font-size:1.15cqw;font-weight:600;letter-spacing:.06em;text-transform:uppercase;text-shadow:0 0.1cqw .6cqw rgba(0,0,0,.4)}
.gi-mark{position:absolute;right:2.4cqw;bottom:2.2cqw;color:rgba(255,255,255,.9);font-size:1.5cqw;font-weight:700;letter-spacing:.02em;text-shadow:0 0.1cqw .6cqw rgba(0,0,0,.4)}
.gi-end{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;opacity:0}
.gi-card{background:rgba(250,250,247,.94);border-radius:1.2cqw;padding:3.2cqw 4.6cqw;text-align:center;box-shadow:0 1.2cqw 4cqw rgba(20,30,28,.25)}
.gi-word{font-size:5.4cqw;font-weight:700;color:#1B201D;letter-spacing:-0.01em;line-height:1}
.gi-word b{color:#1F3D2E;font-weight:700}
.gi-line{margin-top:1.2cqw;font-size:2.1cqw;font-weight:500;color:#3f4842}
.gi-offer{margin-top:1.6cqw;font-size:1.7cqw;font-weight:650;color:#1F3D2E;letter-spacing:.02em}
`;

export function createDemo(container, opts = {}) {
  const width = opts.width || container.clientWidth || 1280;
  const height = opts.height || Math.round(width * 9 / 16);
  if (!document.getElementById('gi-style')) { const st = document.createElement('style'); st.id = 'gi-style'; st.textContent = STYLE; document.head.appendChild(st); }
  container.classList.add('gi-stage');

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: !!opts.preserve, powerPreference: 'high-performance' });
  renderer.setPixelRatio(opts.pixelRatio || Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(width, height, !opts.fixedSize ? false : true);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.18;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.shadowMap.autoUpdate = false;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = skyTexture();
  scene.fog = new THREE.Fog(0xe6ecee, 35, 210);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

  const hemi = new THREE.HemisphereLight(0xf6f2ea, 0xc8b496, 0.5); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe7c6, 3.3);
  sun.position.set(-3.0, 9.5, 21.0); sun.target.position.set(6.0, 0, 4.5); scene.add(sun, sun.target);
  for (const [x, z] of [[9.0, 5.6], [9.6, 1.6], [6.2, 5.0], [2.6, 6.3], [1.7, 1.4], [4.6, 1.5], [1.1, 4.2], [4.0, 3.55], [6.7, 1.4]]) {
    const pl = new THREE.PointLight(0xffe2bd, 2.6, 7.0, 2); pl.position.set(x, 1.95, z); scene.add(pl);
  }
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -11, right: 11, top: 11, bottom: -11, near: 1, far: 50 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;

  const M = makeMaterials();
  const floors = new THREE.Group(), walls = new THREE.Group(), furniture = new THREE.Group(), ceilings = new THREE.Group(), context = new THREE.Group(), corridor = new THREE.Group(), corridorCeil = new THREE.Group();
  buildFloors(floors, M); buildWalls(walls, M); buildFurniture(furniture, M); buildDecor(furniture, M); buildCeilings(ceilings, M); buildContext(context, corridor, M);
  { const geo = new THREE.PlaneGeometry(10, 2.47); geo.rotateX(Math.PI / 2); const m = new THREE.Mesh(geo, M.ceiling); m.position.set(6.5, H, -1.365); corridorCeil.add(m); }
  scene.add(floors, walls, furniture, ceilings, context, corridor, corridorCeil);

  // plan sheet used for the opening shot
  const vb = PLAN_VIEWBOX;
  const planMesh = new THREE.Mesh(new THREE.PlaneGeometry(vb.w, vb.h), M.planOverlay);
  planMesh.rotation.x = -Math.PI / 2; planMesh.position.set(vb.x + vb.w / 2, 0.006, vb.y + vb.h / 2); planMesh.renderOrder = 2;
  scene.add(planMesh);
  const ready = new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = 2048; c.height = Math.round(2048 * vb.h / vb.w);
      const g = c.getContext('2d'); g.drawImage(img, 0, 0, c.width, c.height);
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
      M.planOverlay.map = tex; M.planOverlay.needsUpdate = true; resolve();
    };
    img.onerror = () => resolve();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(planSVG(PLAN, { background: '#ffffff', font: "'Helvetica Neue', Arial, sans-serif" }));
  });

  const camera = new THREE.PerspectiveCamera(36, width / height, 0.05, 400);

  // overlay
  const ov = document.createElement('div'); ov.className = 'gi-ov';
  ov.innerHTML = `<div class="gi-tag">Sample · original demo plan</div><div class="gi-cap"><i></i><span></span></div><div class="gi-mark">Glide Inside</div>` +
    `<div class="gi-end"><div class="gi-card"><div class="gi-word">Glide <b>Inside</b></div><div class="gi-line">3D fly-throughs from your floor plan</div><div class="gi-offer">$249 per fly-through, delivered in 48 hours</div></div></div>`;
  container.appendChild(ov);
  const capEl = ov.querySelector('.gi-cap'), capText = ov.querySelector('.gi-cap span'), endEl = ov.querySelector('.gi-end'), markEl = ov.querySelector('.gi-mark');

  let lastScaleKey = '';
  function setBuild(t) {
    const ws = Math.max(0.002, smooth(1.2, 4.2, t)), fs = Math.max(0.002, smooth(3.4, 5.8, t)), cs = Math.max(0.002, smooth(11.0, 12.6, t));
    walls.scale.y = ws; furniture.scale.y = fs; corridor.scale.y = cs; corridor.visible = t > 10.8;
    const po = 1 - smooth(3.2, 5.6, t); M.planOverlay.opacity = po; planMesh.visible = po > 0.001;
    const key = `${ws.toFixed(4)}|${fs.toFixed(4)}|${cs.toFixed(4)}|${corridor.visible}`;
    if (key !== lastScaleKey) { renderer.shadowMap.needsUpdate = true; lastScaleKey = key; }
  }
  function setCeilings(camY, force) {
    const o = force === false ? 0 : 1 - smooth(2.25, 2.62, camY);
    M.ceiling.opacity = o; ceilings.visible = o > 0.001; corridorCeil.visible = ceilings.visible;
    M.ceiling.depthWrite = o > 0.98;
  }
  function setOverlay(t) {
    let cap = null, a = 0;
    for (const [t0, t1, text] of CAPTIONS) if (t >= t0 && t <= t1) { cap = text; a = Math.min(smooth(t0, t0 + 0.5, t), 1 - smooth(t1 - 0.5, t1, t)); }
    if (cap) { capText.textContent = cap; capEl.style.opacity = a.toFixed(3); capEl.style.transform = `translateY(${((1 - a) * 0.6).toFixed(3)}cqw)`; } else capEl.style.opacity = '0';
    const e = smooth(56.4, 57.3, t); endEl.style.opacity = e.toFixed(3); markEl.style.opacity = (1 - e).toFixed(3);
  }

  function renderAt(t) {
    setBuild(t);
    const c = cameraAt(t);
    camera.position.set(...c.p); camera.lookAt(new THREE.Vector3(...c.q));
    if (Math.abs(camera.fov - c.f) > 1e-3) { camera.fov = c.f; camera.updateProjectionMatrix(); }
    setCeilings(camera.position.y, t < 6 ? false : undefined);
    setOverlay(t);
    renderer.render(scene, camera);
  }

  // interactive mode
  let controls = null, mode = 'film', playing = false, time = 0, last = 0, raf = 0, onTime = null, dirty = true;
  function loop(now) {
    raf = requestAnimationFrame(loop);
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0; last = now;
    if (mode === 'film') {
      if (playing) { time += dt; if (time >= DURATION) { time = DURATION; playing = false; } dirty = true; }
      if (dirty) { renderAt(time); dirty = false; }
      onTime && onTime(time, playing);
    } else {
      const moved = controls.update();
      if (moved || dirty) {
        setBuild(60); setCeilings(99, false);
        capEl.style.opacity = '0'; endEl.style.opacity = '0'; markEl.style.opacity = '1';
        renderer.render(scene, camera); dirty = false;
      }
    }
  }
  function resize(w, h) { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); dirty = true; }

  return {
    ready, renderAt, renderer, scene, camera, resize,
    start() { if (!raf) { last = 0; raf = requestAnimationFrame(loop); } },
    stop() { cancelAnimationFrame(raf); raf = 0; },
    play() { if (time >= DURATION) time = 0; playing = true; dirty = true; },
    pause() { playing = false; },
    seek(t) { time = clamp(t, 0, DURATION); dirty = true; },
    get time() { return time; }, get playing() { return playing; }, get mode() { return mode; },
    onTime(fn) { onTime = fn; },
    setMode(m) {
      mode = m; dirty = true;
      if (m === 'explore') {
        playing = false;
        if (!controls) { controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.47; controls.minDistance = 6; controls.maxDistance = 34; }
        camera.fov = 40; camera.updateProjectionMatrix();
        camera.position.set(16, 13, 16); controls.target.set(6, 0, 4.8); controls.update();
        controls.enabled = true;
      } else if (controls) { controls.enabled = false; }
    },
  };
}
